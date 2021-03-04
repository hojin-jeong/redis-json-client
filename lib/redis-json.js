
const IORedis = require('ioredis')

module.exports =
    class RedisJSON {
        constructor(opts = {}) {
            this.$redis = undefined
            if(typeof opts === "object")
                this.$opts = {
                    port: opts.ports || 6379,
                    host: opts.hosts || 'localhost',
                    db: opts.db || 0,
                    password: opts.password || null
                }
            else
                this.$opts = opts
            this.$internalCommands = {}
            this.$supportedCommands = new Set(require('./supportedCommands'))
        }

        /**
         * Exception이 발생하지 않도록 JSON을 파싱한다.
         * Exception 발생시 들어온 데이터를 그대로 내보낸다.
         *
         * @param target
         * @returns {any}
         */
        $_safetyJsonParse(target) {
            if(typeof target === 'object') return target
            try {
                return JSON.parse(target)
            } catch(_) {
                return target
            }
        }

        /**
         * ioredis의 BuiltinCommand를 사용하여 명령어를 전송한다.
         * 해당 command object는 캐싱되며, 존재하지 않는다면 생성하여 캐시에 집어넣는다.
         *
         * @param command
         * @param args
         * @returns {Promise<>}
         */
        async $_callCommand(command, args) {
            if(!this.$supportedCommands.has(command)) {
                throw new Error('Unsupported Command')
            }

            let cmd = this.$internalCommands[command]
            if(!cmd) {
                this.$internalCommands[command] = cmd = this.$redis.createBuiltinCommand(command)
            }

            const r = await cmd.string.call(this.$redis, args)
            if(r instanceof Error) throw r

            return this.$_safetyJsonParse(r)
        }

        /**
         * RedisJSON의 Path는 .a.b.c, [a][b][c], a[b][c] 와 같은 구조로 작성되어야한다.
         * 해당 클라이언트에서는 [a][b][c]의 구조를 사용한다.
         *
         * @param path
         * @returns {string}
         */
        $_pathMaker(path) {
            if(path.constructor === String) {
                if(path.startsWith('[') && path.endsWith(']')) return path
                else path = path.split('.')
            }
            if(path.length > 0) {
                let nPath = ""
                for(const p of path) {
                    if(p.length === 0) break
                    if(isNaN(p)) {
                        nPath += `['${p}']`
                    } else {
                        nPath += `[${p}]`
                    }
                }
                if(nPath.length === 0) nPath = '.'
                return nPath
            } else {
                return '.'
            }
        }

        /**
         * value를 무조건 배열로 만들어준다. (value가 배열일 경우 바로 리턴)
         *
         * @param value
         * @returns {array}
         */
        $_arrayMaker(value) {
            if(!Array.isArray(value)) return [value]
            return value
        }

        /**
         * 상위의 부모를 찾고 존재하지 않는다면 생성한다.
         *
         * @param key
         * @param path
         * @param value
         * @returns {Promise<result>}
         */
        async $_findAndCreateParentObject(key, path, value) {
            let paths = path
            if(path.constructor === String) paths = path.split('.')

            let setValue = value
            while(paths.length) {
                const cPath = this.$_pathMaker(paths.slice(0, -1))
                const type = await this.type(key, cPath)
                if(type !== null) {
                    break
                }
                setValue = {
                    [paths.pop()]: setValue
                }
            }

            const cPath = this.$_pathMaker(paths)
            return this.set(key, cPath, setValue, {recursive: false})
        }

        /**
         * 레디스 서버에 연결.
         *
         * @returns {Promise}
         */
        connect() {
            return new Promise((resolve, reject) => {
                this.$redis = new IORedis(this.$opts)
                this.$redis.on('ready', resolve)
                this.$redis.on('error', reject)
            })
        }

        /**
         * path에 존재하는 value를 JSON Serialized form으로 가져온다.
         * 기본적으로 path가 존재하지 않으면 root로 지정된다.
         *
         * 시간 복잡도: O(N), N은 Values의 크기.
         * @param key
         * @param path
         * @returns {Promise<json>}
         */
        get(key, path) {
            const args = [
                key,
                this.$_pathMaker(path)
            ]
            return this.$_callCommand('JSON.GET', args)
        }

        /**
         * 여러개의 key에 속한 데이터를 가져온다. key나 path가 존재하지 않으면 null을 리턴받는다.
         *
         * 시간 복잡도: O(M*N), M은 key의 갯수, N은 value의 크기
         * @param keys
         * @param path
         * @returns {Promise<json>}
         */
        async mget(keys, path) {
            const args = [
                ...this.$_arrayMaker(keys),
                this.$_pathMaker(path)
            ]
            const r = await this.$_callCommand('JSON.MGET', args)
            if(r instanceof Error) throw r

            const json = {}
            for(let i=0; i<keys.length; i++) {
                json[keys[i]] = this.$_safetyJsonParse(r[i])
            }

            return json
        }

        /**
         * JSON데이터를 path에 저장한다.
         * 새로운 key값의 경우 무조건 root구조를 생성하여야한다. 만약 key가 생성되어있고, 해당 path가 존재한다면 데이터는 대치된다.
         *
         * recursive 옵션이 있을경우에 상위 부모의 데이터를 작성한다. (상위 부모가 존재하지 않으면, JSON.TYPE을 사용하여 체크)
         *
         * 시간 복잡도:
         * recursive false - O(M+N), M은 해당 path에 존재하던 데이터들의 크기 (존재한다면), N은 새롭게 적용할 데이터들의 크기
         * recursive true - O(P+M+N), P는 path의 깊이이며(만약 부모가 존재하지 않다면), M은 해당 path에 존재하던 데이터들의 크기 (존재한다면), N은 새롭게 적용할 데이터들의 크기
         * @param key
         * @param path
         * @param value
         * @param opts {{recursive: boolean}}
         * @returns {Promise<result>}
         */
        async set(key, path, value, opts) {
            const args = [
                key,
                this.$_pathMaker(path),
                JSON.stringify(value)
            ]
            const r = await this.$_callCommand('JSON.SET', args)
            if(r instanceof Error) {
                const message = r.message
                if(opts.recursive === true &&
                    (
                        message.includes('non-terminal path level') ||
                        message.includes('must be created at the root') ||
                        message.includes('at level 0 in path')
                    )
                ) {
                    const rc = await this.$_findAndCreateParentObject(key, path, value)
                    if(rc instanceof Error) throw rc
                    return rc
                } else throw r
            }

            return r
        }

        /**
         * 데이터를 제거한다.
         * 기본적으로 path가 존재하지 않으면 root로 지정된다. 존재하지 않는 key나 path가 적용된 경우에는 명령이 무시된다.
         * JSON의 root를 제거하는 명령은 Redis의 key를 제거하는 명령과 같다.
         *
         * 시간 복잡도: O(N), N은 삭제할 데이터의 크기
         * @param key
         * @param path
         * @returns {Promise<result>}
         */
        del(key, path) {
            const args = [
                key,
                this.$_pathMaker(path)
            ]
            return this.$_callCommand('JSON.DEL', args)
        }

        /**
         * 'JSON.DEL'으로 리다이렉션.
         *
         * @param key
         * @param path
         * @returns {Promise<result>}
         */
        forgot(key, path) {
            return this.del(key, path)
        }

        /**
         * 해당 path에 타입을 가져온다.
         * 기본적으로 path가 존재하지 않으면 root로 지정된다. key나 path가 존재하지 않을경우 null을 리턴받는다.
         *
         * 시간 복잡도: O(1)
         * @param key
         * @param path
         * @returns {Promise<type>}
         */
        type(key, path) {
            const args = [
                key,
                this.$_pathMaker(path)
            ]
            return this.$_callCommand('JSON.TYPE', args)
        }

        /**
         * 해당 path에 저장된 숫자를 value만큼 증가시킨다.
         *
         * 시간 복잡도: O(1)
         * @param key
         * @param path
         * @param value
         * @returns {Promise<json>}
         */
        inc(key, path, value) {
            const args = [
                key,
                this.$_pathMaker(path),
                value
            ]
            return this.$_callCommand('JSON.NUMINCRBY', args)
        }

        /**
         * 해당 path에 저장된 숫자를 value만큼 곱한다.
         *
         * 시간 복잡도: O(1)
         * @param key
         * @param path
         * @param value
         * @returns {Promise<json>}
         */
        mul(key, path, value) {
            const args = [
                key,
                this.$_pathMaker(path),
                value
            ]
            return this.$_callCommand('JSON.NUMMULTBY', args)
        }

        /**
         * 해당 path에 저장된 문자열 뒤에 value를 추가한다.
         *
         * 시간 복잡도: O(N), N은 추가할 문자열 길이
         * @param key
         * @param path
         * @param value
         * @returns {Promise<length>}
         */
        strand(key, path, value) {
            const args = [
                key,
                this.$_pathMaker(path),
                JSON.stringify(value)
            ]
            return this.$_callCommand('JSON.STRAPPEND', args)
        }

        /**
         * 해당 path에 저장된 문자열의 길이를 가져온다.
         *
         * 시간 복잡도: O(1)
         * @param key
         * @param path
         * @returns {Promise<length>}
         */
        strlen(key, path) {
            const args = [
                key,
                this.$_pathMaker(path)
            ]
            return this.$_callCommand('JSON.STRLEN', args)
        }

        /**
         * 해당 path에 저장된 배열의 마지막에 value를 추가한다.
         *
         * 시간 복잡도: O(1)
         * @param key
         * @param path
         * @param values
         * @returns {Promise<size>}
         */
        arrand(key, path, values) {
            const args = [
                key,
                this.$_pathMaker(path),
                ...this.$_arrayMaker(values).map(value => JSON.stringify(value))
            ]
            return this.$_callCommand('JSON.ARRAPPEND', args)
        }

        /**
         * 해당 path에 저장된 배열에서 value의 index를 찾는다.
         *
         * 시간 복잡도: O(N), N은 배열의 크기
         * @param key
         * @param path
         * @param value
         * @returns {Promise<index>}
         */
        arridx(key, path, value) {
            const args = [
                key,
                this.$_pathMaker(path),
                JSON.stringify(value)
            ]
            return this.$_callCommand('JSON.ARRINDEX', args)
        }

        /**
         * 해당 path에 저장된 배열의 index 위치에 values를 추가한다.
         *
         * 시간 복잡도: O(N), N은 배열의 크기
         * @param key
         * @param path
         * @param index
         * @param values
         * @returns {Promise<size>}
         */
        arrins(key, path, index, values) {
            const args = [
                key,
                this.$_pathMaker(path),
                index,
                ...this.$_arrayMaker(values).map(value => JSON.stringify(value))
            ]
            return this.$_callCommand('JSON.ARRINSERT', args)
        }

        /**
         * 해당 path에 저장된 배열의 크기를 가져온다.
         *
         * 시간 복잡도: O(1)
         * @param key
         * @param path
         * @returns {Promise<length>}
         */
        arrlen(key, path) {
            const args = [
                key,
                this.$_pathMaker(path)
            ]
            return this.$_callCommand('JSON.ARRLEN', args)
        }

        /**
         * 해당 path에 저장된 배열의 1개 데이터를 제거하면서 가져온다.
         * index가 지정될 경우 index 위치에 있는 데이터 1개를 가져온다.
         *
         * 시간 복잡도: O(N), N은 배열의 크기 (index가 지정되지 않았을 경우 N은 1)
         * @param key
         * @param path
         * @param index
         * @returns {Promise<json>}
         */
        arrpop(key, path, index) {
            const args = [
                key,
                this.$_pathMaker(path)
            ]
            if(index !== undefined) args.push(index)
            return this.$_callCommand('JSON.ARRLEN', args)
        }

        /**
         * 해당 path에 저장된 배열을 자른다.
         * 이 기능은 관대하도록 작성되어있어 out of bounds가 발생하지 않는다.
         *
         * 시간 복잡도: O(N), N은 배열의 크기
         * @param key
         * @param path
         * @param start
         * @param end
         * @returns {Promise<size>}
         */
        arrtrim(key, path, start, end) {
            const args = [
                key,
                this.$_pathMaker(path),
                start,
                end
            ]
            return this.$_callCommand('JSON.ARRTRIM', args)
        }

        /**
         * 해당 path에 저장된 객체의 keys를 가져온다.
         *
         * 시간 복잡도: O(N), N은 객체의 크기
         * @param key
         * @param path
         * @returns {Promise<json>}
         */
        objkeys(key, path) {
            const args = [
                key,
                this.$_pathMaker(path)
            ]
            return this.$_callCommand('JSON.OBJKEYS', args)
        }

        /**
         * 해당 path에 저장된 객체의 크기를 가져온다.
         *
         * 시간 복잡도: O(1)
         * @param key
         * @param path
         * @returns {Promise<size>}
         */
        objlen(key, path) {
            const args = [
                key,
                this.$_pathMaker(path)
            ]
            return this.$_callCommand('JSON.OBJLEN', args)
        }

        /**
         * RedisJSON Debug 전용 커맨드.
         *
         * @param args
         * @returns {Promise<json>}
         */
        debug(args) {
            return this.$_callCommand('JSON.DEBUG', args)
        }

        /**
         * RESP(Redis Serialization Protocol) String을 가져온다.
         *
         * 시간 복잡도: O(N), N은 JSON values 개수
         * @param key
         * @param path
         * @returns {Promise}
         */
        resp(key, path) {
            const args = [
                key,
                this.$_pathMaker(path)
            ]
            return this.$_callCommand('JSON.RESP', args)
        }
    }
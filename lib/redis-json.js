
const IORedis = require('ioredis')
const EventEmitter = require('events').EventEmitter

module.exports =
    class RedisJSON extends EventEmitter {
        constructor(opts = {}) {
            super()

            this.$redis = undefined
            this.$opts = {
                port: opts.ports || 6379,
                host: opts.hosts || 'localhost',
                db: opts.db || 0,
                password: opts.password || null
            }
            this.$internalCommands = {}
            this.$supportedCommands = new Set(require('./supportedCommands'))
        }

        /**
         * ioredis의 BuiltinCommand를 사용하여 명령어를 전송한다.
         * 해당 command object는 캐싱되며, 존재하지 않는다면 생성하여 캐시에 집어넣는다.
         *
         * @param command
         * @param args
         * @returns {Promise<>}
         */
        $_callCommand(command, args) {
            if(!this.$supportedCommands.has(command)) {
                return Promise.reject('Unsupported Command')
            }
            return new Promise((resolve, reject) => {
                let cmd = this.$internalCommands[command]
                if(!cmd) {
                    this.$internalCommands[command] = cmd = this.$redis.createBuiltinCommand(command)
                }
                cmd.string.call(this.$redis, ...args)
                    .then(response => {
                        if(typeof response === "object") return resolve(response)
                        try {
                            resolve(JSON.parse(response))
                        } catch(err) {
                            resolve(response)
                        }
                    })
                    .catch(reject)
            })
        }

        /**
         * RedisJSON의 Path는 .a.b.c, [a][b][c], a[b][c] 와 같은 구조로 작성되어야한다.
         * 해당 클라이언트에서는 .a.b.c의 구조를 사용한다. 따라서 path의 prefix에 .이 존재하지 않는다면 추가해준다.
         *
         * TODO: 정규식을 사용하여 path가 구조와 맞지 않을경우 null을 리턴하도록
         *
         * @param path
         * @returns {string}
         */
        $_pathMaker(path) {
            if(!path.startsWith('.')) path = '.' + path
            return path
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
            const paths = path.split('.')

            let setValue = value
            while(paths.length) {
                setValue = {
                    [paths.pop()]: setValue
                }
                const cPath = this.$_pathMaker(paths.join('.'))
                const type = await this.type(key, cPath)
                if(type !== null) break
            }

            const cPath = this.$_pathMaker(paths.join('.'))
            return this.set(key, cPath, setValue)
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
            return this.$_callCommand('JSON.GET',
                [
                    key,
                    this.$_pathMaker(path)
                ]
            )
        }

        /**
         * 여러개의 key에 속한 데이터를 가져온다. key나 path가 존재하지 않으면 null을 리턴받는다.
         *
         * 시간 복잡도: O(M*N), M은 key의 갯수, N은 value의 크기
         * @param keys
         * @param path
         * @returns {Promise<json>}
         */
        mget(keys, path) {
            return new Promise((resolve, reject) => {
                if(!Array.isArray(keys)) keys = [keys]
                this.$_callCommand('JSON.MGET',
                    [
                        ...keys,
                        this.$_pathMaker(path)
                    ]
                ).then(response => {
                    const json = {}
                    for(let i=0; i<keys.length; i++) {
                        json[keys[i]] = JSON.parse(response[i])
                    }
                    resolve(json)
                }).catch(reject)
            })
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
        set(key, path, value, opts) {
            return new Promise((resolve, reject) => {
                this.$_callCommand('JSON.SET',
                    [
                        key,
                        this.$_pathMaker(path),
                        JSON.stringify(value)
                    ]
                ).then(resolve)
                    .catch(err => {
                        const message = err.message
                        if(opts.recursive === true &&
                            (
                                message.includes('non-terminal path level') ||
                                message.includes('must be created at the root') ||
                                message.includes('at level 0 in path')
                            )
                        ) {
                            this.$_findAndCreateParentObject(key, path, value)
                                .then(resolve)
                                .catch(reject)
                        } else {
                            reject(err)
                        }
                    })
            })
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
            return this.$_callCommand('JSON.DEL',
                [
                    key,
                    this.$_pathMaker(path)
                ]
            )
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
            return this.$_callCommand('JSON.TYPE',
                [
                    key,
                    this.$_pathMaker(path)
                ]
            )
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
            return this.$_callCommand('JSON.NUMINCRBY',
                [
                    key,
                    this.$_pathMaker(path),
                    value
                ]
            )
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
            return this.$_callCommand('JSON.NUMMULTBY',
                [
                    key,
                    this.$_pathMaker(path),
                    value
                ]
            )
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
            return this.$_callCommand('JSON.STRAPPEND',
                [
                    key,
                    this.$_pathMaker(path),
                    JSON.stringify(value)
                ]
            )
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
            return this.$_callCommand('JSON.STRLEN',
                [
                    key,
                    this.$_pathMaker(path)
                ]
            )
        }

        /**
         * 해당 path에 저장된 array의 마지막에 value를 추가한다.
         *
         * 시간 복잡도: O(1)
         * @param key
         * @param path
         * @param values
         * @returns {Promise<size>}
         */
        arrand(key, path, values) {
            if(!Array.isArray(values)) values = [values]
            return this.$_callCommand('JSON.ARRAPPEND',
                [
                    key,
                    this.$_pathMaker(path),
                    ...values.map(value => JSON.stringify(value))
                ]
            )
        }

        /**
         * 해당 path에 저장된 array에서 value의 index를 찾는다.
         *
         * 시간 복잡도: O(N), N은 array의 크기
         * @param key
         * @param path
         * @param value
         * @returns {Promise<index>}
         */
        arridx(key, path, value) {
            return this.$_callCommand('JSON.ARRINDEX',
                [
                    key,
                    this.$_pathMaker(path),
                    JSON.stringify(value)
                ]
            )
        }
    }
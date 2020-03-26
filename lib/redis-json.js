
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
         * ioredis의 BuiltinCommand Object를 가져온다.
         * 해당 object는 command를 키로 사용하여 캐싱되며, 만약 존재하지 않는다면 생성하여 리턴한다.
         *
         * @param command
         * @returns {undefined|cmd}
         */
        $_getInternalCommand(command) {
            if(!this.$supportedCommands.has(command)) {
                console.log("Unsupported Command.")
                return undefined
            }
            let cmd = this.$internalCommands[command]
            if(!cmd) {
                this.$internalCommands[command] = cmd = this.$redis.createBuiltinCommand(command)
            }
            return cmd
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
            const paths = path.split('.').slice(1)

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
         * path에 존재하는 value를 JSON Serialized form으로 리턴받는다.
         * 기본적으로 path가 존재하지 않으면 root로 지정된다.
         *
         * 시간 복잡도: O(N), N은 Values의 크기.
         * @param key
         * @param path
         * @returns {Promise<json>}
         */
        get(key, path) {
            return new Promise((resolve, reject) => {
                path = this.$_pathMaker(path)
                const cmd = this.$_getInternalCommand('JSON.GET')
                cmd.string.call(this.$redis, key, path)
                    .then(buffer => {
                        resolve(JSON.parse(buffer))
                    })
                    .catch(reject)
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
         * @param opts { recursive }
         * @returns {Promise<result>}
         */
        set(key, path, value, opts) {
            return new Promise((resolve, reject) => {
                path = this.$_pathMaker(path)
                const cmd = this.$_getInternalCommand('JSON.SET')
                cmd.string.call(this.$redis, key, path, JSON.stringify(value))
                    .then(resolve)
                    .catch(err => {
                        const message = err.message
                        if(opts.recursive === true
                            && message.includes('non-terminal path level')
                            || message.includes('must be created at the root')) {
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
            path = this.$_pathMaker(path)
            const cmd = this.$_getInternalCommand('JSON.DEL')
            return cmd.string.call(this.$redis, key, path)
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
         * 해당 path의 타입을 리턴받는다.
         * 기본적으로 path가 존재하지 않으면 root로 지정된다. key나 path가 존재하지 않을경우 null을 리턴받는다.
         *
         * 시간 복잡도: O(1).
         * @param key
         * @param path
         * @returns {Promise<type>}
         */
        type(key, path) {
            path = this.$_pathMaker(path)
            const cmd = this.$_getInternalCommand('JSON.TYPE')
            return cmd.string.call(this.$redis, key, path)
        }
    }
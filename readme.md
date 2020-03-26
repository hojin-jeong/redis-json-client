# RedisJSON-Client

Redis에서 JSON타입을 직접 사용할 수 있게 만들어주는 RedisJSON의 NodeJS 클라이언트
(https://github.com/RedisJSON/RedisJSON)

IORedis의 createBuiltinCommand를 사용하여 만들어졌음.
(https://github.com/luin/ioredis)

모든 명령어는 Promise로 리턴하므로 async await 사용가능.

# Quick Start

## Installation
```shell
npm install redis-json-client
```

## Basic Usage
```javascript
const RedisJSONClient = require('redis-json-client')

const opts = {
  ports: 6379,
  hosts: '127.0.0.1',
  db: 0,
  password: 'password'
}
const client = new RedisJSONClient(opts)

// Redis 연결
client.connect()
  .then(_ => {
    // 데이터 저장 (부모가 존재하지 않으면 생성)
    client.setForce('key', 'path.a.b', {alpha: 'beta'})
      .then(_ => {
        // 데이터 불러오기
        client.get('key', 'path.a.b.alpha')
          .then(json => {
            console.log(json)
          })      
      })  
  })
  .catch(err => {
    console.error(err)
    process.exit()  
  })
```

# Commands

### JSON.GET
```javascript
client.get(key, path)
  .then(json)
  .catch(err)
```
### JSON.SET
```javascript
client.set(key, path, value, { recursive })
  .then(result)
  .catch(err)
```
### JSON.DEL
```javascript
client.del(key, path)
  .then(result)
  .catch(err)
```
### JSON.FORGOT
```javascript
client.forgot(key, path)
  .then(result)
  .catch(err)
```
### JSON.TYPE
```javascript
client.type(key, path)
  .then(type)
  .catch(err)
```

# License
MIT
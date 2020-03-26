
# RedisJSON-Client
[![GitHub](https://img.shields.io/github/license/hojin-jeong/redis-json-client)](https://github.com/hojin-jeong/redis-json-client/blob/master/license.md)
[![npm](https://img.shields.io/npm/v/redis-json-client)](https://badge.fury.io/js/redis-json-client)

Redis에서 JSON타입을 직접 사용할 수 있게 만들어주는 RedisJSON의 NodeJS 클라이언트

(https://github.com/RedisJSON/RedisJSON)

# Compatibility

### RedisJSON / All Command Support
### RedisJSON2 / Not Confirmed

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

or

const opts = "/tmp/redis.sock"

const client = new RedisJSONClient(opts)

// Redis 연결
client.connect()
  .then(_ => {
    // 데이터 저장 (부모가 존재하지 않으면 생성)
    client.set('key', 'path.a.b', {alpha: 'beta'}, {recursive: true})
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

# Command Examples

### JSON.GET
```javascript
client.get(key, path)
  .then(json)
  .catch(err)
```
### JSON.SET
```javascript
client.set(key, path, value, { recursive: true })
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
### JSON.MGET
```javascript
client.mget(keys, path)
  .then(json)
  .catch(err)
```
### JSON.NUMINCRBY
```javascript
client.inc(key, path, value)
  .then(json)
  .catch(err)
```
### JSON.NUMMULTBY
```javascript
client.mul(key, path, value)
  .then(json)
  .catch(err)
```
### JSON.STRAPPEND
```javascript
client.strand(key, path, value)
  .then(length)
  .catch(err)
```
### JSON.STRLEN
```javascript
client.strlen(key, path)
  .then(length)
  .catch(err)
```
### JSON.ARRAPPEND
```javascript
client.arrand(key, path, values)
  .then(size)
  .catch(err)
```
### JSON.ARRINDEX
```javascript
client.arridx(key, path, value)
  .then(index)
  .catch(err)
```
### JSON.ARRINSERT
```javascript
client.arrins(key, path, index, values)
  .then(size)
  .catch(err)
```
### JSON.ARRLEN
```javascript
client.arrlen(key, path)
  .then(size)
  .catch(err)
```
### JSON.ARRPOP
```javascript
client.arrpop(key, path, [index])
  .then(json)
  .catch(err)
```
### JSON.ARRTRIM
```javascript
client.arrtrim(key, path, start, end)
  .then(size)
  .catch(err)
```
### JSON.OBJKEYS
```javascript
client.objkeys(key, path)
  .then(json)
  .catch(err)
```
### JSON.OBJLEN
```javascript
client.objlen(key, path)
  .then(size)
  .catch(err)
```
### JSON.DEBUG
```javascript
client.debug(args)
  .then(json)
  .catch(err)
```
### JSON.RESP
```javascript
client.resp(args)
  .then(json)
  .catch(err)
```

# License
MIT
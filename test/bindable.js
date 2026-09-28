const test = require('brittle')
const net = require('net')
const dgram = require('dgram')
const { canBind, resolveBind, isUnspecifiedHost } = require('../lib/bindable.js')

function holdTcp(t) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      t.teardown(() => server.close())
      resolve(server.address().port)
    })
  })
}

function holdUdp(t) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', () => {
      t.teardown(() => socket.close())
      resolve(socket.address().port)
    })
  })
}

test('isUnspecifiedHost covers the values Node binds on every interface', (t) => {
  t.ok(isUnspecifiedHost(''))
  t.ok(isUnspecifiedHost('   '))
  t.ok(isUnspecifiedHost(null))
  t.ok(isUnspecifiedHost(undefined))
  t.ok(isUnspecifiedHost('0.0.0.0'))
  t.ok(isUnspecifiedHost('::'))
  t.ok(isUnspecifiedHost('::0'))
  t.absent(isUnspecifiedHost('127.0.0.1'))
  t.absent(isUnspecifiedHost('localhost'))
})

test('canBind accepts a free loopback port and releases it', async (t) => {
  t.ok(await canBind(0, '127.0.0.1'))
  const port = await holdTcp(t)
  t.absent(await canBind(port, '127.0.0.1'), 'port still held after the trial')
  t.ok(await canBind(0, '127.0.0.1', { udp: true }))
  const udpPort = await holdUdp(t)
  t.absent(await canBind(udpPort, '127.0.0.1', { udp: true }))
})

test('canBind rejects unspecified hosts and addresses that are not local', async (t) => {
  t.absent(await canBind(0, ''))
  t.absent(await canBind(0, '0.0.0.0'))
  t.absent(await canBind(0, '::'))
  t.absent(await canBind(0, '192.0.2.1'))
})

test('resolveBind keeps a probed host and port when they can be bound', async (t) => {
  const port = await holdTcp(t)
  const chosen = await resolveBind({ port: 0, host: '127.0.0.1' })
  t.is(chosen.host, '127.0.0.1')
  t.is(chosen.port, 0)
  t.ok(port)
})

test('resolveBind does not adopt an empty or wildcard probed host', async (t) => {
  for (const host of ['', '0.0.0.0', '::']) {
    const chosen = await resolveBind({ port: 0, host })
    t.is(chosen.host, '127.0.0.1', host)
    t.is(chosen.port, 0)
  }
})

test('resolveBind falls back to loopback when the probed host is not local', async (t) => {
  const chosen = await resolveBind({ port: 0, host: '192.0.2.1' })
  t.is(chosen.host, '127.0.0.1')
  t.is(chosen.port, 0)
})

test('resolveBind moves off a probed port that is already taken', async (t) => {
  const port = await holdTcp(t)
  const chosen = await resolveBind({ port, host: '127.0.0.1', fallbackPort: 0 })
  t.is(chosen.host, '127.0.0.1')
  t.is(chosen.port, 0)
  t.not(chosen.port, port)
})

test('resolveBind leaves an explicit host and port alone', async (t) => {
  const chosen = await resolveBind({
    port: 80,
    host: '0.0.0.0',
    explicitHost: true,
    explicitPort: true
  })
  t.is(chosen.host, '0.0.0.0')
  t.is(chosen.port, 80)
})

test('resolveBind keeps an explicit port when only the probed host is unusable', async (t) => {
  const chosen = await resolveBind({
    port: 4242,
    host: '',
    explicitPort: true
  })
  t.is(chosen.host, '127.0.0.1')
  t.is(chosen.port, 4242)
})

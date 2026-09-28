const net = require('net')
const dgram = require('dgram')

// Node treats listen/bind on '' as '::', and on '0.0.0.0' / '::' as every
// interface. A server that never set a host still probes back '' (the
// protocol default), so those values must not be adopted unless the caller
// asked for them.
const UNSPECIFIED_HOSTS = new Set(['', '0.0.0.0', '::', '::0'])

function isUnspecifiedHost(host) {
  if (host == null) return true
  return UNSPECIFIED_HOSTS.has(String(host).trim().toLowerCase())
}

function toPort(port) {
  const n = +port
  if (!Number.isInteger(n) || n < 0 || n > 65535) return null
  return n
}

// True only when this process can bind `host:port` for the tunnel protocol.
// Unspecified hosts are rejected even though the OS would accept them.
function canBind(port, host, { udp = false } = {}) {
  if (isUnspecifiedHost(host)) return Promise.resolve(false)
  const portNum = toPort(port)
  if (portNum === null) return Promise.resolve(false)
  const address = String(host).trim()

  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    if (udp) {
      const socket = dgram.createSocket(net.isIP(address) === 6 ? 'udp6' : 'udp4')
      socket.once('error', () => finish(false))
      socket.once('listening', () => {
        socket.removeAllListeners('error')
        socket.on('error', () => {})
        socket.close(() => finish(true))
      })
      try {
        socket.bind(portNum, address)
      } catch {
        finish(false)
      }
      return
    }

    const server = net.createServer()
    server.once('error', () => finish(false))
    server.once('listening', () => {
      server.removeAllListeners('error')
      server.on('error', () => {})
      server.close(() => finish(true))
    })
    try {
      server.listen(portNum, address)
    } catch {
      finish(false)
    }
  })
}

// Pick the address the local proxy should listen on. An advertised host/port
// is used only when `canBind` succeeds. Otherwise fall back to loopback, then
// to `fallbackPort`, then to an ephemeral port. An explicit host and port are
// returned unchanged.
async function resolveBind({
  port,
  host,
  udp = false,
  explicitHost = false,
  explicitPort = false,
  fallbackHost = '127.0.0.1',
  fallbackPort = 8989
} = {}) {
  if (explicitHost && explicitPort) return { port, host }

  const candidateHost = explicitHost || !isUnspecifiedHost(host) ? host : null
  if (candidateHost != null && (await canBind(port, candidateHost, { udp }))) {
    return { port, host: candidateHost }
  }

  // The caller asked for every interface, or for a specific host. Don't
  // quietly move that choice; the real listen surfaces any failure.
  if (explicitHost) return { port, host }

  if (await canBind(port, fallbackHost, { udp })) {
    return { port, host: fallbackHost }
  }

  if (explicitPort) return { port, host: fallbackHost }

  if (await canBind(fallbackPort, fallbackHost, { udp })) {
    return { port: fallbackPort, host: fallbackHost }
  }

  return { port: 0, host: fallbackHost }
}

module.exports = {
  canBind,
  resolveBind,
  isUnspecifiedHost
}


const Pipeline = require('..')

process.once('uncaughtException', err => {
  process.send(err.message)
  process.exit(0)
})

new Pipeline({
  transitions: {s0: ['s1']}
})
  .on('@error', err => { throw new Error('failed in @error') })
  .on('s0', () => { throw new Error() })
  .start('s0')

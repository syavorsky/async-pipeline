
const Pipeline = require('..')

process.once('uncaughtException', err => {
  process.send(err.message)
  process.exit(0)
})

new Pipeline({
  transitions: {s0: ['s1']}
})
  .on('@error', () => {})
  .on('@end', err => { throw new Error('failed in @end') })
  .on('s0', () => { throw new Error() })
  .start('s0')

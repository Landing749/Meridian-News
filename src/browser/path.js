// Tiny stand-in for node:path (the routes only use basename).
module.exports = { basename: p => String(p || '').split(/[\\/]/).pop() };

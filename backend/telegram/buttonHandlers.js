/**
 * Backend Telegram Button Handlers proxy / export
 */
const mod = require('../../modules/telegram/buttonHandlers');
const ButtonHandlers = mod.ButtonHandlers || mod.default || mod;

module.exports = ButtonHandlers;
module.exports.ButtonHandlers = ButtonHandlers;
module.exports.default = ButtonHandlers;


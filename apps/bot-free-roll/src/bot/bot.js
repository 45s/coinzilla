export class Bot {
  constructor(config) {
    this.#validateConfig({ config })
  }

  #validateConfig({ config }) {}
}

Bot.prototype.initialize = function () {}
Bot.prototype.run = function () {}

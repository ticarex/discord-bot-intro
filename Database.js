const fs = require("fs");

class Database {
    constructor(filename) {
        this.filename = filename;
        this.version = 2;
        this.db = null;

        if (fs.existsSync(this.filename)) {
            this._loadFromFile();
        } else {
            this._loadDefault();
        }
    }

    user(id) {
        if (!this.db.users[id])
            this.db.users[id] = {};

        return this.db.users[id];
    }

    guild(id) {
        if (!this.db.guilds[id])
            this.db.guilds[id] = {};

        return this.db.guilds[id];
    }

    save() {
        fs.writeFileSync(this.filename, JSON.stringify(this.db, null, 4));
    }

    _loadFromFile() {
        this.db = JSON.parse(fs.readFileSync(this.filename, {
            encoding: 'utf8'
        }));

        this._upgrade()
    }

    _loadDefault() {
        this.db = {
            version: this.version,
            guilds: {},
            users: {}
        };
    }

    _upgrade() {
        const version = this.db.version ? this.db.version : 1;

        if (version == this.version) return;

        switch (version) {
            case 1:
                const users = this.db;
                this.db = {
                    users,
                    guilds: {},
                    version: 2
                }
                this.save();
                break;
            default:
                throw new Error("Versão desconhecida: " + version);
        }

        return this._upgrade(this.db.version);
    }
}

module.exports = new Database("db.json");
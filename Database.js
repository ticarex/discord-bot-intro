const fs = require("fs");

class Database {
    constructor(filename) {
        this.filename = filename;
        this.db = {};

        this.init();
    }

    get() {
        return this.db;
    }

    init() {
        if (fs.existsSync(this.filename))
            this.load();
        else
            this.save();
    }

    load() {
        this.db = JSON.parse(fs.readFileSync(this.filename, {
            encoding: 'utf8'
        }));
    }

    save() {
        fs.writeFileSync(this.filename, JSON.stringify(this.db, null, 4));
    }
}

module.exports = new Database("db.json");
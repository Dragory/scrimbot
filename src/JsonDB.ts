import {promisify} from 'util';
import * as path from 'path';
import * as fs from 'fs';
import mkdirp from 'mkdirp';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

export class JsonDB {
    protected path: string;
    protected def: any;
    protected data: any;

    protected initPromise: Promise<any>;
    protected loadPromise: Promise<any>;
    protected savePromise: Promise<any>;

    constructor(dbPath: string, def: any = {}) {
        this.path = dbPath;
        this.def = def;

        this.savePromise = Promise.resolve();
    }

    public async get() {
        await this.load();
        return this.data;
    }

    public async save() {
        this.savePromise = this.savePromise.then(() => {
            return writeFile(this.path, JSON.stringify(this.data, null, 4));
        });

        return this.savePromise;
    }

    protected init() {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise((resolve, reject) => {
            mkdirp(path.dirname(this.path), err => {
                if (err) return reject(err);
            });
        });

        return this.initPromise;
    }

    protected load() {
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = new Promise(async (resolve, reject) => {
            await this.init();
            const data = await readFile(this.path, {encoding: 'utf8'});
            this.data = JSON.parse(data);
        });

        return this.loadPromise;
    }
}
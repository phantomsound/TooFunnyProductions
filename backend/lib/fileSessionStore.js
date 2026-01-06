import fs from "node:fs/promises";
import path from "node:path";
import session from "express-session";

export class FileSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.dir = options.dir || path.resolve(process.cwd(), ".sessions");
    this.ttl = options.ttl || 1000 * 60 * 60 * 24 * 7;
    this.ensureDirPromise = fs.mkdir(this.dir, { recursive: true }).catch((error) => {
      console.error("[session-store] Failed to prepare session directory:", error);
    });
  }

  async ensureDir() {
    return this.ensureDirPromise;
  }

  async get(sid, callback = () => {}) {
    try {
      await this.ensureDir();
      const filePath = this.getFilePath(sid);
      const raw = await fs.readFile(filePath, "utf8");
      let record = null;
      try {
        record = JSON.parse(raw);
      } catch (error) {
        console.warn("[session-store] Failed to parse session file; resetting.", error?.message || error);
        await this.destroy(sid);
        return callback(null, null);
      }
      if (this.isExpired(record)) {
        await this.destroy(sid);
        return callback(null, null);
      }
      return callback(null, record.data || null);
    } catch (error) {
      if (error && error.code === "ENOENT") return callback(null, null);
      return callback(error);
    }
  }

  async set(sid, sess, callback = () => {}) {
    try {
      await this.ensureDir();
      const filePath = this.getFilePath(sid);
      const record = {
        data: sess,
        expires: this.getExpires(sess),
      };
      await fs.writeFile(filePath, JSON.stringify(record), "utf8");
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  async destroy(sid, callback = () => {}) {
    try {
      await this.ensureDir();
      const filePath = this.getFilePath(sid);
      await fs.rm(filePath, { force: true });
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  async touch(sid, sess, callback = () => {}) {
    try {
      await this.ensureDir();
      const filePath = this.getFilePath(sid);
      const record = {
        data: sess,
        expires: this.getExpires(sess),
      };
      await fs.writeFile(filePath, JSON.stringify(record), "utf8");
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  getFilePath(sid) {
    return path.join(this.dir, `${sid}.json`);
  }

  getExpires(sess) {
    if (sess && sess.cookie) {
      if (sess.cookie.expires instanceof Date) return sess.cookie.expires.getTime();
      if (typeof sess.cookie.expires === "string") {
        const parsed = Date.parse(sess.cookie.expires);
        if (!Number.isNaN(parsed)) return parsed;
      }
      if (typeof sess.cookie.maxAge === "number") {
        return Date.now() + sess.cookie.maxAge;
      }
    }
    return Date.now() + this.ttl;
  }

  isExpired(record) {
    if (!record || !record.expires) return false;
    return Date.now() > record.expires;
  }
}

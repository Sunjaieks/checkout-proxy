export class LRUCache {
    capacity = 10;
    ttl = 0;
    cache = new Map();
    cleanup = null;

    constructor(capacity, ttl, cleanup) {
        if (Number.isInteger(capacity) && capacity > 0) {
            this.capacity = capacity;
        }
        if (Number.isInteger(ttl) && ttl > 0) {
            this.ttl = ttl;
        }
        if (typeof cleanup === 'function') {
            this.cleanup = cleanup;
        }
    }

    get(key) {
        const value = this.cache.get(key);
        if (value) {
            if (this.ttl > 0 && new Date() - value[1] > this.ttl) {
                this.cache.delete(key);
                this.cleanup?.(value[0]);
                return null;
            }
            this.cache.delete(key);
            this.cache.set(key, value);
            return value[0];
        }
        return null;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            const old = this.cache.get(key);
            this.cache.delete(key);
            this.cleanup?.(old[0]);
        } else if (this.cache.size >= this.capacity) {
            const oldestKey = this.cache.keys().next().value;
            const old = this.cache.get(oldestKey);
            this.cache.delete(oldestKey);
            this.cleanup?.(old[0]);
        }
        this.cache.set(key, [value, new Date()]);
        return value;
    }

    clear() {
        if (this.cleanup) {
            this.cache.forEach((v, k) => this.cleanup(v[0]));
        }
        this.cache.clear();
    }
}

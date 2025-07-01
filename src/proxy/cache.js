export class LRUCache {
    capacity = 10;
    ttl = 0;
    cache = new Map();

    constructor(capacity, ttl) {
        if (Number.isInteger(capacity) && capacity > 0) {
            this.capacity = capacity;
        }
        if (Number.isInteger(ttl) && ttl > 0) {
            this.ttl = ttl;
        }
    }

    get(key) {
        const value = this.cache.get(key);
        if (value) {
            if (this.ttl > 0 && (new Date() - value[1]) > this.ttl) {
                this.cache.delete(key);
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
            this.cache.delete(key);
        } else if (this.cache.size >= this.capacity) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        this.cache.set(key, [value, new Date()]);
    }
}

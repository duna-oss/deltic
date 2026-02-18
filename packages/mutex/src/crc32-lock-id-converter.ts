import crc32 from 'crc/crc32';
import type {LockIdConverter, LockRange} from './pg.js';

export class Crc32LockIdConverter implements LockIdConverter<string> {
    constructor(private lockRange: LockRange) {}

    convert(id: string): number {
        return this.lockRange.base + (crc32(id) % this.lockRange.range);
    }
}

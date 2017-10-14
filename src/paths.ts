import * as path from 'path';

const paths: {[key: string]: string} = {};
paths.root = process.cwd();
paths.data = path.resolve(paths.root, 'data');

export {paths};

export function dataDir(...pathSegments: string[]) {
    return path.resolve(paths.data, ...pathSegments);
}

import {ICommandOptions} from 'knub';

export const cmdPresets: {[name: string]: ICommandOptions} = {
    admin: {
        permissions: {
            level: 100
        }
    },

    mod: {
        permissions: {
            level: 50
        }
    }
};

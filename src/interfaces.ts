export interface ILobby {
    owner: string;
    name: string;
    voiceChannels: string[];
    size: number;
    players: string[];
}

export interface IPlayer {
    id: string;
    regions: string[];
    battleTag: string;
    sr: number;
    roles: string[];
    voice: boolean;
}

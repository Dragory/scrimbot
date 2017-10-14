import {IPlayer} from "./interfaces";
import {shuffle} from "./util";

export interface ISortedPlayer extends IPlayer {
    sortSR?: number;
    assignedRole?: string;
}

export interface ITeam {
    players: ISortedPlayer[];
    averageSR: number;
}

const srAccuracy = 500;

export function balanceTeams(inputPlayers: IPlayer[], teamCount = 2): ITeam[] {
    let players: ISortedPlayer[] = JSON.parse(JSON.stringify(inputPlayers));
    let teams: ITeam[] = [];

    const uniqueRoles = players.reduce((roles, player) => {
        player.roles.forEach(role => roles.add(role));
        return roles;
    }, new Set());

    // Adjust hidden/sort SR
    players = players.map(player => {
        player.sortSR = Math.round(player.sr / srAccuracy) * srAccuracy;
        return player;
    });

    // Sort players so that those with most roles are last for optimal role distribution
    players.sort((a, b) => {
        if (a.roles.length > b.roles.length) return 1;
        if (a.roles.length < b.roles.length) return -1;

        return 0;
    });

    const roleSorted = Array.from(players);

    // Figure out roles for each players evenly
    const perRole = Math.floor(players.length / Math.max(uniqueRoles.size, 1));
    const roleCounts: {[id: string]: number} = {};

    players = players.map(player => {
        for (const role of player.roles) {
            if ((roleCounts[role] || 0) < perRole) {
                player.assignedRole = role;
            }
        }

        if (player.assignedRole == null) {
            player.assignedRole = player.roles[0];
        }

        roleCounts[player.assignedRole] = (roleCounts[player.assignedRole] || 0) + 1;

        return player;
    });

    // Sort players by role => sr
    players.sort((a, b) => {
        if (a.assignedRole > b.assignedRole) return 1;
        if (a.assignedRole < b.assignedRole) return -1;
        if (a.sortSR > b.sortSR) return -1;
        if (a.sortSR < b.sortSR) return 1;
        if (a.voice && ! b.voice) return -1;
        if (b.voice && ! a.voice) return 1;
        return 0;
    });

    // Distribute players to teams
    for (let i = 0; i < teamCount; i++) teams.push({players: [], averageSR: 0});

    let currentTeam = 0;
    let inCurrentTeam = 0;
    for (const player of players) {
        teams[currentTeam].players.push(player);

        // 1-2-...-2-1
        inCurrentTeam++;
        if (inCurrentTeam === 2) {
            currentTeam += 1;
            if (currentTeam >= teamCount) {
                currentTeam = 0;
            }

            inCurrentTeam = 0;
        }
    }

    // Sort players inside teams for a prettier output
    teams = teams.map(team => {
        team.players.sort((a, b) => {
            if (a.assignedRole > b.assignedRole) return 1;
            if (a.assignedRole < b.assignedRole) return -1;
            if (a.sr > b.sr) return -1; // Actual SR here
            if (a.sr < b.sr) return 1;
            return 0;
        });
        const totalSR = team.players.reduce((total, p) => total + p.sr, 0);
        team.averageSR = Math.round(totalSR / Math.max(team.players.length, 1));
        return team;
    });

    return teams;
}

import { DatabaseManager } from './database/manager.js';
import * as net from 'net';

export class CommandHandler {
    static async onCommand(command: string, args: Array<string>) {
        if (args[0].toLowerCase() == 'help') { return CommandHandler.onHelp(command, args.slice(1)); }
        if (args[0].toLowerCase() == 'ban') { return CommandHandler.onBan(command, args.slice(1)); }
        if (args[0].toLowerCase() == 'unban') { return CommandHandler.onUnban(command, args.slice(1)); }
        if (args[0].toLowerCase() == 'vacuum') { return CommandHandler.onVacuum(command, args.slice(1)); }
        console.log(`Unknown command: ${args[0]}. Type "help" for a list of commands.`);
    }

    private static async onHelp(command: string, args: Array<string>) {
        console.log(`
            Available Commands:
            • help                - Show this help message
            • ban <ip>            - Ban the specified IP address
            • unban <ip>          - Unban the specified IP address
            • vacuum              - Compress database size
        `.trim());
    }

    private static async onBan(command: string, args: Array<string>) {
        if (!net.isIP(args[0])) { return console.log(`Invalid or missing IP address. Usage: ban <ip>`); }
        await DatabaseManager.setIPBanned(args[0], true);
        console.log(`Banned user with IP: ${args[0]}`);
    }

    private static async onUnban(command: string, args: Array<string>) {
        if (!net.isIP(args[0])) { return console.log(`Invalid or missing IP address. Usage: unban <ip>`); }
        await DatabaseManager.setIPBanned(args[0], false);
        console.log(`Unbanned user with IP: ${args[0]}`);
    }

    private static async onVacuum(command: string, args: Array<string>) {
        await DatabaseManager.vacuum();
    }
}
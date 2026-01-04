// @ts-check
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context)
{
    /* ----------------------------
     * BADGE DECORATION
     * ---------------------------- */

    const emitter = new vscode.EventEmitter();

    const provider =
    {
        onDidChangeFileDecorations: emitter.event,

        provideFileDecoration(uri)
        {
            try
            {
                const stat = fs.statSync(uri.fsPath);
                if (!stat.isDirectory())
                {
                    return;
                }

                if (fs.existsSync(path.join(uri.fsPath, '.fail')))
                {
                    return {
                        badge: '×',
                        tooltip: 'FAIL',
                        color: new vscode.ThemeColor('testing.iconFailed')
                    };
                }

                if (fs.existsSync(path.join(uri.fsPath, '.pass')))
                {
                    return {
                        badge: '+',
                        tooltip: 'PASS'
                    };
                }
            }
            catch
            {
                // ignore fs races / permission issues
            }
        }
    };

    const markerWatcher =
        vscode.workspace.createFileSystemWatcher('**/{.pass,.fail}');

    function refreshParent(uri)
    {
        const parent = vscode.Uri.file(path.dirname(uri.fsPath));
        emitter.fire([parent]);
    }

    markerWatcher.onDidCreate(refreshParent);
    markerWatcher.onDidDelete(refreshParent);
    markerWatcher.onDidChange(refreshParent);

    /* ------------------------------------
     * TEST FOLDER CREATION NOTIFIER
     * ------------------------------------ */

    const statusBarItem =
        vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );

    statusBarItem.tooltip = 'Click to open the latest test folder';
    statusBarItem.hide();

    async function openLastCreatedFolder(folderUri)
    {
        await vscode.commands.executeCommand(
            'vscode.openFolder',
            folderUri,
            true
        );
    }

    // Register command once
    const openFolderCommand =
        vscode.commands.registerCommand(
            'badger.openLastTestFolder',
            openLastCreatedFolder
        );

    function isWatchedTestFolder(uri)
    {
        const config =
            vscode.workspace.getConfiguration('badger');

        const watchedRoots =
            config.get('watchDirectories', ['tests']);

        return watchedRoots.some(root =>
        {
            const normalizedRoot =
                path.normalize(root + path.sep);

            return uri.fsPath.includes(normalizedRoot);
        });
    }

    const folderWatcher =
        vscode.workspace.createFileSystemWatcher('**/');

    folderWatcher.onDidCreate(uri =>
    {
        try
        {
            const stat = fs.statSync(uri.fsPath);
            if (!stat.isDirectory())
            {
                return;
            }

            if (!isWatchedTestFolder(uri))
            {
                return;
            }

            const label =
                path.relative(
                    vscode.workspace.workspaceFolders[0].uri.fsPath,
                    uri.fsPath
                );

            statusBarItem.text =
                `$(beaker) New test folder: ${label}`;

            statusBarItem.command =
            {
                command: 'badger.openLastTestFolder',
                title: 'Open test folder',
                arguments: [uri]
            };

            statusBarItem.show();
        }
        catch
        {
            // ignore race conditions
        }
    });

    /* ----------------------------
     * SUBSCRIPTIONS
     * ---------------------------- */

    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(provider),
        markerWatcher,
        folderWatcher,
        emitter,
        statusBarItem,
        openFolderCommand
    );
}

function deactivate()
{
}

module.exports = { activate, deactivate };

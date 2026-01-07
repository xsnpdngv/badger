// @ts-check
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {

    /* ----------------------------
     * BADGE DECORATION
     * ---------------------------- */

    const emitter = new vscode.EventEmitter();

    const provider = {

        onDidChangeFileDecorations: emitter.event,

        provideFileDecoration(uri) {
            try {
                const stat = fs.statSync(uri.fsPath);
                if ( ! stat.isDirectory()) {
                    return;
                }

                if (fs.existsSync(path.join(uri.fsPath, '.fail'))) {
                    return {
                        badge: '×',
                        tooltip: 'FAIL',
                        color: new vscode.ThemeColor('testing.iconFailed')
                    };
                }

                if (fs.existsSync(path.join(uri.fsPath, '.pass'))) {
                    return {
                        badge: '+',
                        tooltip: 'PASS'
                    };
                }
            } catch { /* ignore */ }
        }
    };


    function refreshParent(uri) {
        const parent = vscode.Uri.file(path.dirname(uri.fsPath));
        emitter.fire([parent]);
    }

    const markerWatcher = vscode.workspace.createFileSystemWatcher('**/{.pass,.fail}');
    markerWatcher.onDidCreate(refreshParent);
    markerWatcher.onDidDelete(refreshParent);
    markerWatcher.onDidChange(refreshParent);


    /* ------------------------------------
     * TEST FOLDER CREATION NOTIFIER
     * ------------------------------------ */

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.tooltip = 'Click to open folder';

    const dismissBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    dismissBtn.text = '$(x)';
    dismissBtn.tooltip = 'Dismiss';
    dismissBtn.command = 'badger.dismissStatus';

    function hideNotification() {
        statusBarItem.hide();
        dismissBtn.hide();
    }

    async function openLastCreatedFolder(folderUri) {
        await vscode.commands.executeCommand('workbench.view.explorer');
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        await vscode.commands.executeCommand('revealInExplorer', folderUri);
        await vscode.commands.executeCommand('list.expand');
    }

    // Register command once
    const openFolderCommand = vscode.commands.registerCommand('badger.openLastTestFolder', openLastCreatedFolder);
    const dismissCommand = vscode.commands.registerCommand('badger.dismissStatus', hideNotification);

    /**
     * Checks if the created folder is inside any of the configured watch directories.
     */
    function isWatchedTestFolder(uri) {

        if ( ! vscode.workspace.workspaceFolders) {
            return false;
        }

        const config = vscode.workspace.getConfiguration('badger');
        const watchedRoots = config.get('watchDirectories', ['tests']);
        const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        return watchedRoots.some(root => {
            const absoluteWatchPath = path.join(wsRoot, root);
            const relative = path.relative(absoluteWatchPath, uri.fsPath);

            // If the relative path doesn't start with '..' and isn't absolute, 
            // it's inside the watched directory.
            return relative && ! relative.startsWith('..') && ! path.isAbsolute(relative);
        });
    }

    /**
     * Validates if the base watch directories still exist.
     */
    function validateWatchEnvironment() {

        if ( ! vscode.workspace.workspaceFolders) {
            hideNotification();
            return;
        }

        const config = vscode.workspace.getConfiguration('badger');
        const watchedRoots = config.get('watchDirectories', ['tests']);
        const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        const anyRootExists = watchedRoots.some(root => fs.existsSync(path.join(wsRoot, root)));
        if ( ! anyRootExists) {
            hideNotification();
        }
    }

    // Modification: Using RelativePattern instead of string glob to ensure the watcher
    // attaches to the workspace root, making it resilient to missing/recreated folders.
    function setupFolderWatcher() {

        if ( ! vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return;
        }

        // const folderWatcher =
        //     vscode.workspace.createFileSystemWatcher('**/');
        const folderWatcher =
            vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], '**/*')
            );

        // Function to process a URI and check if it's a test folder
        const checkAndNotify = (uri) => {

            try {
                if ( ! fs.existsSync(uri.fsPath)) {
                    return;
                }

                const stat = fs.statSync(uri.fsPath);
                if ( ! stat.isDirectory()) {
                    return;
                }

                if (isWatchedTestFolder(uri)) {
                    const label = path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, uri.fsPath);
                    statusBarItem.text = `$(link) ${label}`;
                    statusBarItem.command = {
                        command: 'badger.openLastTestFolder',
                        title: 'Open test folder',
                        arguments: [uri]
                    };
                    statusBarItem.show();
                    dismissBtn.show();
                } else {
                    // scan it for children that might have been missed
                    const children = fs.readdirSync(uri.fsPath);
                    for (const child of children) {
                        checkAndNotify(vscode.Uri.file(path.join(uri.fsPath, child)));
                    }
                }
            } catch { /* ignore */ }
        };

        folderWatcher.onDidCreate(uri => {
            checkAndNotify(uri);
        });

        folderWatcher.onDidDelete(uri => {
            // Hide if the specific reported folder is deleted
            if (statusBarItem.command && statusBarItem.command.arguments[0].fsPath === uri.fsPath) {
                hideNotification();
            }
            // Hide if the entire 'tests' (or configured) directory is deleted
            validateWatchEnvironment();

            context.subscriptions.push(folderWatcher);
        });

        context.subscriptions.push(folderWatcher);
    }

    // Initial call
    setupFolderWatcher();

    /* ----------------------------
     * SUBSCRIPTIONS
     * ---------------------------- */

    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(provider),
        markerWatcher,
        emitter,
        statusBarItem,
        dismissBtn,
        openFolderCommand,
        dismissCommand
    );
}

function deactivate() {}

module.exports = { activate, deactivate };

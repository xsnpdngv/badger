// @ts-check
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context)
{
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
                // ignore fs races / permission errors
            }
        }
    };

    const watcher =
        vscode.workspace.createFileSystemWatcher(
            '**/{.pass,.fail}'
        );

    function refreshParent(uri)
    {
        const parent =
            vscode.Uri.file(path.dirname(uri.fsPath));
        emitter.fire([parent]);
    }

    watcher.onDidCreate(refreshParent);
    watcher.onDidDelete(refreshParent);
    watcher.onDidChange(refreshParent);

    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(provider),
        watcher,
        emitter
    );
}

function deactivate()
{
}

module.exports = { activate, deactivate };

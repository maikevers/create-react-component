import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  console.log("React Component Creator extension is now active!");

  let disposable = vscode.commands.registerCommand(
    "extension.createReactComponent",
    createReactComponent
  );
  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: "typescriptreact", scheme: "file" },
      new ReactComponentQuickFix(),
      {
        providedCodeActionKinds: ReactComponentQuickFix.providedCodeActionKinds,
      }
    )
  );
}

class ReactComponentQuickFix implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] | undefined {
    const diagnostics = context.diagnostics;
    if (diagnostics.length > 0) {
      for (const diagnostic of diagnostics) {
        if (
          diagnostic.message.includes("Cannot find name") ||
          diagnostic.message.includes("is not defined")
        ) {
          const componentName = document.getText(diagnostic.range);
          if (this.isValidComponentName(componentName)) {
            return this.createComponentAction(componentName);
          }
        }
      }
    }

    const line = document.lineAt(range.start.line);
    const componentNameMatch = line.text.match(/<([A-Z]\w+)(\s|\/|>)/);
    if (componentNameMatch) {
      const componentName = componentNameMatch[1];
      return this.createComponentAction(componentName);
    }

    return undefined;
  }

  private isValidComponentName(name: string): boolean {
    return /^[A-Z]\w+$/.test(name);
  }

  private createComponentAction(componentName: string): vscode.CodeAction[] {
    const createComponentAction = new vscode.CodeAction(
      `Create new React component '${componentName}'`,
      vscode.CodeActionKind.QuickFix
    );

    createComponentAction.command = {
      command: "extension.createReactComponent",
      title: "Create React Component",
      arguments: [componentName],
    };

    createComponentAction.isPreferred = true;
    createComponentAction.diagnostics = [];
    createComponentAction.kind =
      vscode.CodeActionKind.QuickFix.append("create");

    return [createComponentAction];
  }
}

import * as fs from "fs";

async function createReactComponent(componentName?: string) {
  if (!componentName) {
    componentName = await vscode.window.showInputBox({
      prompt: "Enter the name of the new React component",
      validateInput: (value) => {
        return value && /^[A-Z][a-zA-Z0-9]*$/.test(value)
          ? null
          : "Component name must start with a capital letter and contain only alphanumeric characters";
      },
    });
  }

  if (!componentName) {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor!");
    return;
  }

  const document = editor.document;
  const currentFileUri = document.uri;
  const currentDir = vscode.Uri.joinPath(currentFileUri, "..");
  const componentPath = vscode.Uri.joinPath(currentDir, `${componentName}.tsx`);

  // Check if file already exists
  if (fs.existsSync(componentPath.fsPath)) {
    vscode.window.showInformationMessage(
      `Component ${componentName} already exists. No changes made.`
    );
    return;
  }

  const selection = editor.selection;
  const line = document.lineAt(selection.start.line);
  const componentRegex = new RegExp(
    `<${componentName}([^>]*)>?(.*?)</${componentName}>?|<${componentName}([^>]*)/>`,
    "g"
  );
  const match = componentRegex.exec(line.text);

  let props: { [key: string]: string } = {};
  let isHOC = false;

  if (match) {
    const propsString = match[1] || match[3] || "";
    const propsRegex = /(\w+)=\{([^}]*)\}/g;
    let propMatch;
    while ((propMatch = propsRegex.exec(propsString)) !== null) {
      props[propMatch[1]] = propMatch[2];
    }

    isHOC = match[2] !== undefined && match[2].trim() !== "";
  }

  const propsTypeString = Object.entries(props)
    .map(([key, value]) => `  ${key}: ${getTypeFromValue(value)};`)
    .join("\n");

  const propsDestructuring = Object.keys(props).join(", ");

  let componentContent: string;

  if (isHOC) {
    componentContent = `import React from 'react';\n\ntype ${componentName}Props = {\n${propsTypeString}\n  children: React.ReactNode;\n};\n\nconst ${componentName} = ({ ${propsDestructuring}${
      propsDestructuring ? ", " : ""
    }children }: ${componentName}Props) => {\n  return (\n    <div>\n      {children}\n    </div>\n  );\n};\n\nexport default ${componentName};\n`;
  } else if (Object.keys(props).length > 0) {
    componentContent = `import React from 'react';\n\ntype ${componentName}Props = {\n${propsTypeString}\n};\n\nconst ${componentName} = ({ ${propsDestructuring} }: ${componentName}Props) => {\n  return (\n    <div>\n      ${componentName}\n    </div>\n  );\n};\n\nexport default ${componentName};\n`;
  } else {
    componentContent = `import React from 'react';\n\nconst ${componentName} = () => {\n  return (\n    <div>\n      ${componentName}\n    </div>\n  );\n};\n\nexport default ${componentName};\n`;
  }

  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.createFile(componentPath, { ignoreIfExists: true });
  workspaceEdit.insert(
    componentPath,
    new vscode.Position(0, 0),
    componentContent
  );

  try {
    const editApplied = await vscode.workspace.applyEdit(workspaceEdit);
    if (editApplied) {
      vscode.window.showInformationMessage(
        `Component ${componentName} created successfully!`
      );
    } else {
      vscode.window.showErrorMessage(
        `Failed to create component ${componentName}.`
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Error creating component: ${error}`);
  }

  const importStatement = `import ${componentName} from './${componentName}';\n`;
  try {
    await editor.edit((editBuilder) => {
      const firstLine = document.lineAt(0);
      const secondLine = document.lineAt(1);

      let insertPosition = new vscode.Position(0, 0);

      const isUseDirective = (line: string) =>
        /^(['"])use client\1;?$/.test(line.trim()) ||
        /^(['"])use server\1;?$/.test(line.trim());

      if (isUseDirective(firstLine.text)) {
        if (isUseDirective(secondLine.text)) {
          insertPosition = new vscode.Position(2, 0);
        } else {
          insertPosition = new vscode.Position(1, 0);
        }
      }

      editBuilder.insert(insertPosition, importStatement);
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Error adding import statement: ${error}`);
  }
}

function getTypeFromValue(value: string): string {
  if (value === "true" || value === "false") {
    return "boolean";
  }
  if (value.startsWith('"') || value.startsWith("'")) {
    return "string";
  }
  if (!isNaN(Number(value))) {
    return "number";
  }
  return "any";
}

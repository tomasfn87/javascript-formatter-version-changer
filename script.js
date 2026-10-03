let inputEditor, outputEditor;

const SETTINGS_KEY = 'gtm_formatter_settings';
const CONTROL_IDS = [
    'gtmMode',
    'colorTheme',
    'fontFamily',
    'indentation',
    'blockNewlines',
    'maxOneEmptyLine',
    'varModernize',
    'varGrouping',
    'quotes',
    'semicolons',
    'printWidth',
    'bracketSpacing',
    'trailingComma',
    'jsVersion'
];

function saveSettings() {
    const settings = {};
    CONTROL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            settings[id] = el.type === 'checkbox' ? el.checked : el.value;
        }
    });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;

    try {
        const settings = JSON.parse(saved);
        CONTROL_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el && settings[id] !== undefined) {
                if (el.type === 'checkbox') {
                    el.checked = settings[id];
                } else {
                    el.value = settings[id];
                }
            }
        });
    } catch (e) {
        console.error('Erro ao carregar configurações do localStorage:', e);
    }
}

function bindAutoSave() {
    CONTROL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                saveSettings();
            });
        }
    });
}

// --- FUNÇÃO AUXILIAR DE AGRUPAMENTO (Single-Pass por container) ---
function groupDeclarationsInContainer(containerPath, t) {
    const bodyPaths = containerPath.get('body');
    if (!bodyPaths || bodyPaths.length < 2) return;

    const newBodyNodes = [];
    let i = 0;

    while (i < bodyPaths.length) {
        const currentPath = bodyPaths[i];

        if (!currentPath.isVariableDeclaration()) {
            newBodyNodes.push(currentPath.node);
            i++;
            continue;
        }

        const currentKind = currentPath.node.kind;
        const matchedDeclarators = [...currentPath.node.declarations];
        let j = i + 1;

        while (j < bodyPaths.length) {
            const nextPath = bodyPaths[j];
            if (
                nextPath.isVariableDeclaration() &&
                nextPath.node.kind === currentKind
            ) {
                matchedDeclarators.push(...nextPath.node.declarations);
                j++;
            } else {
                break;
            }
        }

        if (j > i + 1) {
            const groupedDeclaration = t.variableDeclaration(currentKind, matchedDeclarators);
            newBodyNodes.push(groupedDeclaration);
        } else {
            newBodyNodes.push(currentPath.node);
        }

        i = j;
    }

    containerPath.node.body = newBodyNodes;
}

// --- PLUGIN: Agrupar Variáveis Consecutivas ---
function babelPluginGroupVars({ types: t }) {
    return {
        visitor: {
            BlockStatement(path) { groupDeclarationsInContainer(path, t); },
            Program(path) { groupDeclarationsInContainer(path, t); }
        }
    };
}

// --- PLUGIN: Separar Variáveis ---
function babelPluginSplitVars({ types: t }) {
    return {
        visitor: {
            VariableDeclaration(path) {
                if (
                    path.parentPath.isForInStatement() ||
                    path.parentPath.isForOfStatement() ||
                    (path.parentPath.isForStatement() && path.parentKey === 'init')
                ) {
                    return;
                }
                if (path.node.declarations.length > 1) {
                    const kind = path.node.kind;
                    const newDeclarations = path.node.declarations.map(decl =>
                        t.variableDeclaration(kind, [decl])
                    );
                    path.replaceWithMultiple(newDeclarations);
                }
            }
        }
    };
}

function babelPluginModernizeVars(groupingMode) {
    return function ({ types: t }) {
        return {
            visitor: {
                Program(path) {
                    path.traverse({
                        VariableDeclaration(varPath) {
                            if (
                                varPath.parentPath.isForInStatement() ||
                                varPath.parentPath.isForOfStatement()
                            ) {
                                return;
                            }

                            varPath.node.kind = 'var';

                            if (varPath.node.declarations.length > 1) {
                                const standaloneVars = varPath.node.declarations.map(decl =>
                                    t.variableDeclaration('var', [decl])
                                );
                                varPath.replaceWithMultiple(standaloneVars);
                            }
                        }
                    });

                    path.scope.crawl();

                    path.traverse({
                        VariableDeclaration(varPath) {
                            const isForInit =
                                varPath.parentPath.isForStatement() && varPath.parentKey === 'init';

                            if (isForInit) {
                                let isConstant = true;
                                for (const decl of varPath.node.declarations) {
                                    if (t.isIdentifier(decl.id)) {
                                        const binding = varPath.scope.getBinding(decl.id.name);
                                        if (binding && (!binding.constant || binding.constantViolations.length > 0)) {
                                            isConstant = false;
                                        }
                                    }
                                }
                                varPath.node.kind = isConstant ? 'const' : 'let';
                                return;
                            }

                            for (const decl of varPath.node.declarations) {
                                if (t.isIdentifier(decl.id)) {
                                    const varName = decl.id.name;
                                    const binding = varPath.scope.getBinding(varName);

                                    let isConstant = true;
                                    if (binding) {
                                        if (!binding.constant || binding.constantViolations.length > 0) {
                                            isConstant = false;
                                        }
                                    }

                                    varPath.node.kind = isConstant ? 'const' : 'let';
                                }
                            }
                        }
                    });

                    path.scope.crawl();

                    if (groupingMode === 'group') {
                        path.traverse({
                            BlockStatement(bPath) {
                                groupDeclarationsInContainer(bPath, t);
                            },
                            Program(pPath) {
                                groupDeclarationsInContainer(pPath, t);
                            }
                        });
                    } else if (groupingMode === 'split') {
                        path.traverse({
                            VariableDeclaration(varPath) {
                                if (
                                    varPath.parentPath.isForInStatement() ||
                                    varPath.parentPath.isForOfStatement() ||
                                    (varPath.parentPath.isForStatement() && varPath.parentKey === 'init')
                                ) {
                                    return;
                                }
                                if (varPath.node.declarations.length > 1) {
                                    const kind = varPath.node.kind;
                                    const newDeclarations = varPath.node.declarations.map(decl =>
                                        t.variableDeclaration(kind, [decl])
                                    );
                                    varPath.replaceWithMultiple(newDeclarations);
                                }
                            }
                        });
                    }
                }
            }
        };
    };
}

// --- PLUGIN: Inserir Marcadores de Linhas em Branco Entre Blocos ---
function babelPluginAddBlockNewlines({ types: t }) {
    return {
        visitor: {
            BlockStatement(path) { processStatements(path.get('body'), t); },
            Program(path) { processStatements(path.get('body'), t); }
        }
    };

    function isBlockOrMultiline(node) {
        if (!node) return false;
        const type = node.type;
        const blockTypes = [
            'FunctionDeclaration', 'ClassDeclaration', 'IfStatement',
            'ForStatement', 'ForInStatement', 'ForOfStatement',
            'WhileStatement', 'DoWhileStatement', 'TryStatement',
            'SwitchStatement'
        ];
        return blockTypes.includes(type);
    }

    function processStatements(statements, t) {
        for (let i = 0; i < statements.length - 1; i++) {
            const current = statements[i].node;
            const next = statements[i + 1].node;

            if (isBlockOrMultiline(current) || isBlockOrMultiline(next)) {
                if (!next.leadingComments) {
                    next.leadingComments = [];
                }
                const hasMarker = next.leadingComments.some(c => c.value === 'BLOCK_NEWLINE');
                if (!hasMarker) {
                    next.leadingComments.push({
                        type: 'CommentBlock',
                        value: 'BLOCK_NEWLINE',
                        leading: true
                    });
                }
            }
        }
    }
}

function babelPluginRemoveUnderscorePrefixes() {
    return {
        visitor: {
            Program(path) {
                path.traverse({
                    VariableDeclarator(p) {
                        if (p.node.id && p.node.id.type === 'Identifier') {
                            const name = p.node.id.name;
                            if (/^_[a-zA-Z0-9]+$/.test(name)) {
                                const cleanName = name.replace(/^_+/, '');
                                const existingBinding = p.scope.hasBinding(cleanName);
                                if (!existingBinding || p.scope.getBinding(cleanName) === p.scope.getBinding(name)) {
                                    p.scope.rename(name, cleanName);
                                }
                            }
                        }
                    }
                });
            }
        }
    };
}

async function writePureTextToClipboard(text) {
    try {
        const blob = new Blob([text], { type: 'text/plain' });
        const item = new ClipboardItem({ 'text/plain': blob });
        await navigator.clipboard.write([item]);
    } catch (e) {
        await navigator.clipboard.writeText(text);
    }
}

function enforcePlainTextCopy(cmInstance) {
    cmInstance.on('copy', (cm, event) => {
        const selectedText = cm.getSelection();
        if (selectedText) {
            event.preventDefault();
            if (event.clipboardData) {
                event.clipboardData.clearData();
                event.clipboardData.setData('text/plain', selectedText);
            } else {
                writePureTextToClipboard(selectedText);
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    bindAutoSave();

    const defaultCode = `function() {
  var test = {{tester}};
  var idGTM = 'GTM-XXXXX';
  var contador = 0;

  if (contador === 0) {
    contador = 1;
  }

  return test + '_' + idGTM;
}`;

    inputEditor = CodeMirror.fromTextArea(document.getElementById('inputCode'), {
        mode: 'javascript',
        theme: document.getElementById('colorTheme').value || 'dracula',
        lineNumbers: true,
        lineWrapping: true
    });

    outputEditor = CodeMirror.fromTextArea(document.getElementById('outputCode'), {
        mode: 'javascript',
        theme: document.getElementById('colorTheme').value || 'dracula',
        lineNumbers: true,
        readOnly: true,
        lineWrapping: true
    });

    enforcePlainTextCopy(inputEditor);
    enforcePlainTextCopy(outputEditor);

    inputEditor.setValue(defaultCode);

    updateTheme();
    updateFont();
});

async function copyInput() {
    const code = inputEditor.getValue();
    if (!code.trim()) {
        showStatus('Nenhum código na ENTRADA para copiar.', 'warning');
        return;
    }
    await writePureTextToClipboard(code);
    showStatus('✓ Código de ENTRADA copiado como texto puro!', 'success');
}

async function copyOutput() {
    const code = outputEditor.getValue();
    if (!code.trim()) {
        showStatus('Nenhum código na SAÍDA para copiar.', 'warning');
        return;
    }
    await writePureTextToClipboard(code);
    showStatus('✓ Código de SAÍDA copiado como texto puro!', 'success');
}

function swapEditors() {
    const outputCode = outputEditor.getValue();
    if (!outputCode.trim()) {
        showStatus('Não há código na saída para inverter.', 'warning');
        return;
    }
    inputEditor.setValue(outputCode);
    outputEditor.setValue('');
    showStatus('⇄ Código de saída movido para a entrada!', 'success');
}

function updateFont() {
    const font = document.getElementById('fontFamily').value;
    document.documentElement.style.setProperty('--code-font', font);
    if (inputEditor) inputEditor.refresh();
    if (outputEditor) outputEditor.refresh();
}

function updateTheme() {
    const themeSelect = document.getElementById('colorTheme');
    const selectedTheme = themeSelect.value;
    const isLight = selectedTheme === 'eclipse' || selectedTheme === 'neo';

    if (inputEditor) inputEditor.setOption('theme', selectedTheme);
    if (outputEditor) outputEditor.setOption('theme', selectedTheme);

    if (isLight) {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
}

// --- TRUQUE INTERMEDIÁRIO DAS ASPAS PARA SINTAXE GTM ---
function sanitizeGTMInput(code) {
    let processedCode = code;

    processedCode = processedCode.replace(/\{\{[\s\S]*?\}\}/g, (match) => {
        return `"${match}"`;
    });

    let isWrappedAnonFunc = false;
    const trimmed = processedCode.trim();

    if (/^function\s*\(/i.test(trimmed)) {
        processedCode = `(${trimmed})`;
        isWrappedAnonFunc = true;
    }

    return { processedCode, isWrappedAnonFunc };
}

function restoreGTMOutput(code, isWrappedAnonFunc) {
    let restoredCode = code;

    restoredCode = restoredCode.replace(/['"](\{\{[\s\S]*?\}\})['"]/g, '$1');

    if (isWrappedAnonFunc) {
        restoredCode = restoredCode.trim();

        if (restoredCode.startsWith(';')) restoredCode = restoredCode.slice(1).trim();
        if (restoredCode.startsWith('(')) restoredCode = restoredCode.slice(1).trim();

        if (restoredCode.endsWith(');')) {
            restoredCode = restoredCode.slice(0, -2).trim();
        } else if (restoredCode.endsWith(')')) {
            restoredCode = restoredCode.slice(0, -1).trim();
        } else if (restoredCode.endsWith(';')) {
            restoredCode = restoredCode.slice(0, -1).trim();
        }
    }

    restoredCode = restoredCode.replace(/\}\s*;$/, '}');

    return restoredCode;
}

async function processJavaScript() {
    const rawCode = inputEditor.getValue();

    if (!rawCode.trim()) {
        showStatus('Insira código para formatar.', 'warning');
        outputEditor.setValue('');
        return;
    }

    const isGtmMode = document.getElementById('gtmMode').checked;

    let codeToProcess = rawCode;
    let isWrappedAnonFunc = false;

    if (isGtmMode) {
        const sanitized = sanitizeGTMInput(rawCode);
        codeToProcess = sanitized.processedCode;
        isWrappedAnonFunc = sanitized.isWrappedAnonFunc;
    }

    try {
        Babel.transform(codeToProcess, { presets: [] });
    } catch (err) {
        let msg = err.message;
        if (isGtmMode) {
            msg += '\n\nNota: O modo GTM JavaScript está ATIVADO no topo.';
        }
        showStatus(`Sintaxe Inválida! Corrija os erros antes de formatar:\n${msg}`, 'error');
        outputEditor.setValue('');
        return;
    }

    const blockNewlines = document.getElementById('blockNewlines').value === 'true';
    const maxOneEmptyLine = document.getElementById('maxOneEmptyLine').value === 'true';
    const varModernize = document.getElementById('varModernize').value === 'true';
    const varGrouping = document.getElementById('varGrouping').value;
    const targetVersion = document.getElementById('jsVersion').value;

    const babelPlugins = [];

    const shouldModernize = varModernize && targetVersion !== 'es5' && targetVersion !== 'es3';

    // 1. Se moderniza, a conversão e o agrupamento/separação rodam integrados na mesma travessia
    if (shouldModernize) {
        babelPlugins.push(babelPluginModernizeVars(varGrouping));
    } else {
        // Caso não modernize (ou seja ES5/ES3), aplica apenas o agrupamento/separação isoladamente
        if (varGrouping === 'split') {
            babelPlugins.push(babelPluginSplitVars);
        } else if (varGrouping === 'group') {
            babelPlugins.push(babelPluginGroupVars);
        }
    }

    babelPlugins.push(babelPluginRemoveUnderscorePrefixes);

    if (blockNewlines) {
        babelPlugins.push(babelPluginAddBlockNewlines);
    }

    let transformedCode = codeToProcess;

    try {
        const presets = [];
        if (targetVersion === 'es5' || targetVersion === 'es3') {
            const targets = targetVersion === 'es3' ? 'ie 8' : 'ie 11';
            presets.push(['env', { targets: targets, modules: false }]);
            if (typeof Babel !== 'undefined' && Babel.availablePlugins) {
                if (Babel.availablePlugins['transform-property-literals']) {
                    babelPlugins.push(Babel.availablePlugins['transform-property-literals']);
                }
                if (Babel.availablePlugins['transform-member-expression-literals']) {
                    babelPlugins.push(Babel.availablePlugins['transform-member-expression-literals']);
                }
            }
        }

        const babelResult = Babel.transform(codeToProcess, {
            presets: presets,
            plugins: babelPlugins
        });
        transformedCode = babelResult.code;

        if (blockNewlines) {
            transformedCode = transformedCode.replace(/\/\*BLOCK_NEWLINE\*\/\s*/g, '\n\n');
        } else {
            transformedCode = transformedCode.replace(/\/\*BLOCK_NEWLINE\*\/\s*/g, '');
        }

    } catch (err) {
        showStatus(`Erro na transformação do Babel: ${err.message}`, 'error');
        return;
    }

    const tabWidth = document.getElementById('indentation').value === 'tab' ? 2 : parseInt(document.getElementById('indentation').value);
    const useTabs = document.getElementById('indentation').value === 'tab';

    const prettierOptions = {
        parser: 'babel',
        plugins: [prettierPlugins.babel, prettierPlugins.estree],
        tabWidth: tabWidth,
        useTabs: useTabs,
        singleQuote: document.getElementById('quotes').value === 'single',
        semi: document.getElementById('semicolons').value === 'true',
        printWidth: parseInt(document.getElementById('printWidth').value),
        bracketSpacing: document.getElementById('bracketSpacing').value === 'true',
        trailingComma: document.getElementById('trailingComma').value,
    };

    try {
        let finalCode = await prettier.format(transformedCode, prettierOptions);

        if (maxOneEmptyLine) {
            finalCode = finalCode.replace(/\n\s*\n\s*\n+/g, '\n\n');
        }

        if (isGtmMode) {
            finalCode = restoreGTMOutput(finalCode, isWrappedAnonFunc);
        }

        outputEditor.setValue(finalCode);
        showStatus('Sucesso! Código higienizado e formatado.', 'success');
    } catch (err) {
        showStatus(`Erro interno de formatação do Prettier: ${err.message}`, 'error');
    }
}

function showStatus(message, type) {
    const statusBar = document.getElementById('statusBar');
    statusBar.textContent = message;
    statusBar.className = `status-bar ${type}`;
}
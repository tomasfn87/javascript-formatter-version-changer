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

// --- HELPER DE AGRUPAMENTO DE VARIÁVEIS ---
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

// --- PLUGINS BABEL ---

// MEDIDOR DE ESPAÇAMENTO GEOMÉTRICO (COMPATÍVEL COM BABEL TRAVERSE)
function babelPluginMarkEmptyLines({ types: t }) {
    return {
        visitor: {
            BlockStatement(path) { checkList(path.node.body); },
            Program(path) { checkList(path.node.body); },
            SwitchStatement(path) { checkList(path.node.cases); }
        }
    };

    function checkList(list) {
        if (!list || !Array.isArray(list) || list.length < 2) return;

        for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1];
            const curr = list[i];

            if (prev && curr && prev.loc && curr.loc) {
                let firstNodeStart = curr.loc.start.line;
                if (curr.leadingComments && curr.leadingComments.length > 0) {
                    firstNodeStart = curr.leadingComments[0].loc.start.line;
                }
                let lastNodeEnd = prev.loc.end.line;
                if (prev.trailingComments && prev.trailingComments.length > 0) {
                    lastNodeEnd = prev.trailingComments[prev.trailingComments.length - 1].loc.end.line;
                }

                const gap = firstNodeStart - lastNodeEnd;

                if (gap > 2) {
                    if (!curr.leadingComments) curr.leadingComments = [];
                    const hasMarker = curr.leadingComments.some(c => c.value && c.value.startsWith('__GTM_BLANK_'));
                    if (!hasMarker) {
                        curr.leadingComments.unshift({
                            type: 'CommentBlock',
                            value: `__GTM_BLANK_${gap}__`,
                            leading: true
                        });
                    }
                }
            }
        }
    }
}

function babelPluginGroupVars({ types: t }) {
    return {
        visitor: {
            BlockStatement(path) { groupDeclarationsInContainer(path, t); },
            Program(path) { groupDeclarationsInContainer(path, t); }
        }
    };
}

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
                            BlockStatement(bPath) { groupDeclarationsInContainer(bPath, t); },
                            Program(pPath) { groupDeclarationsInContainer(pPath, t); }
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

function babelPluginAddBlockNewlines({ types: t }) {
    return {
        visitor: {
            BlockStatement(path) { processStatements(path.get('body'), t); },
            Program(path) { processStatements(path.get('body'), t); }
        }
    };

    function isBlockOrMultiline(node) {
        if (!node) return false;
        const blockTypes = [
            'FunctionDeclaration', 'ClassDeclaration', 'IfStatement',
            'ForStatement', 'ForInStatement', 'ForOfStatement',
            'WhileStatement', 'DoWhileStatement', 'TryStatement',
            'SwitchStatement'
        ];
        return blockTypes.includes(node.type);
    }

    function processStatements(statements, t) {
        for (let i = 0; i < statements.length - 1; i++) {
            const current = statements[i].node;
            const next = statements[i + 1].node;

            if (isBlockOrMultiline(current) || isBlockOrMultiline(next)) {
                if (!next.leadingComments) {
                    next.leadingComments = [];
                }
                const hasMarker = next.leadingComments.some(c => c.value === 'GTM_BLOCK_NEWLINE');
                if (!hasMarker) {
                    next.leadingComments.push({
                        type: 'CommentBlock',
                        value: 'GTM_BLOCK_NEWLINE',
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

// --- UTILITÁRIOS DA UI ---
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
  var test = {{minha var do gtm}};
  var idGTM = 'GTM-XXXXX';
  var contador = 0;


  if (contador === 0) {
    contador = 1;
  }

  return test + '_' + idGTM;
}`;

    const themeSelect = document.getElementById('colorTheme');
    const initialTheme = themeSelect ? themeSelect.value : 'dracula';

    inputEditor = CodeMirror.fromTextArea(document.getElementById('inputCode'), {
        mode: 'javascript',
        theme: initialTheme,
        lineNumbers: true,
        lineWrapping: true
    });

    outputEditor = CodeMirror.fromTextArea(document.getElementById('outputCode'), {
        mode: 'javascript',
        theme: initialTheme,
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

function clearInput() {
    inputEditor.setValue('');
    showStatus('Entrada limpa.', 'info');
}

function clearOutput() {
    outputEditor.setValue('');
    showStatus('Saída limpa.', 'info');
}

function clearAll() {
    inputEditor.setValue('');
    outputEditor.setValue('');
    showStatus('Ambos os editores foram limpos.', 'info');
}

function updateFont() {
    const fontEl = document.getElementById('fontFamily');
    if (!fontEl) return;
    const font = fontEl.value;
    document.documentElement.style.setProperty('--code-font', font);
    if (inputEditor) inputEditor.refresh();
    if (outputEditor) outputEditor.refresh();
}

function updateTheme() {
    const themeSelect = document.getElementById('colorTheme');
    if (!themeSelect) return;

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

// --- SANITIZAÇÃO E RESTAURAÇÃO GTM (ABORDAGEM CIRÚRGICA) ---
let gtmVarMap = [];

function sanitizeGTMInput(code) {
    let sanitizedCode = code.trim();
    let isAnonFunc = false;
    gtmVarMap = [];

    if (/^function\s*\([^)]*\)\s*\{/.test(sanitizedCode)) {
        isAnonFunc = true;
        sanitizedCode = '(' + sanitizedCode + ')';
    }

    sanitizedCode = sanitizedCode.replace(/\{\{[\s\S]*?\}\}/g, (match) => {
        const placeholder = `__GTM_VAR_${gtmVarMap.length}__`;
        gtmVarMap.push(match);
        return placeholder;
    });

    return { sanitizedCode, isAnonFunc };
}

function restoreGTMOutput(code, isAnonFunc) {
    let restoredCode = code.trim();

    if (isAnonFunc) {
        restoredCode = restoredCode.replace(/^\(/, ''); restoredCode = restoredCode.replace(/\)\s*;?\s*$/, '');
    }

    gtmVarMap.forEach((gtmVar, i) => {
        const regex = new RegExp(`__GTM_VAR_${i}__`, 'g');
        restoredCode = restoredCode.replace(regex, gtmVar);
    });

    return restoredCode;
}

// --- MOTOR PRINCIPAL ---
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
        codeToProcess = sanitized.sanitizedCode;
        isWrappedAnonFunc = sanitized.isAnonFunc;
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

    if (!maxOneEmptyLine) {
        babelPlugins.push(babelPluginMarkEmptyLines);
    }

    const shouldModernize = varModernize && targetVersion !== 'es5' && targetVersion !== 'es3';

    if (shouldModernize) {
        babelPlugins.push(babelPluginModernizeVars(varGrouping));
    } else {
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

    } catch (err) {
        showStatus(`Erro na transformação do Babel: ${err.message}`, 'error');
        return;
    }

    const indentVal = document.getElementById('indentation').value;
    const useTabs = indentVal === 'tab';
    const tabWidth = useTabs ? 2 : parseInt(indentVal, 10);

    const prettierOptions = {
        parser: 'babel',
        plugins: [prettierPlugins.babel, prettierPlugins.estree],
        tabWidth: tabWidth,
        useTabs: useTabs,
        singleQuote: document.getElementById('quotes').value === 'single',
        semi: document.getElementById('semicolons').value === 'true',
        printWidth: parseInt(document.getElementById('printWidth').value, 10),
        bracketSpacing: document.getElementById('bracketSpacing').value === 'true',
        trailingComma: document.getElementById('trailingComma').value,
    };

    try {
        let finalCode = await prettier.format(transformedCode, prettierOptions);

        if (blockNewlines) {
            finalCode = finalCode.replace(/^[ \t]*\/\*GTM_BLOCK_NEWLINE\*\/\r?\n?/gm, '\n');
        } else {
            finalCode = finalCode.replace(/^[ \t]*\/\*GTM_BLOCK_NEWLINE\*\/\r?\n?/gm, '');
        }

        if (!maxOneEmptyLine) {
            finalCode = finalCode.replace(/(?:\r?\n)*[ \t]*\/\*__GTM_BLANK_(\d+)__\*\/(?:\r?\n)*/g, (match, count) => {
                return '\n'.repeat(parseInt(count, 10));
            });
        }

        if (isGtmMode) {
            finalCode = restoreGTMOutput(finalCode, isWrappedAnonFunc);
        }

        if (maxOneEmptyLine) {
            finalCode = finalCode.replace(/(\r?\n){3,}/g, '\n\n');
        }

        outputEditor.setValue(finalCode);
        showStatus('Sucesso! Código higienizado, formatado e indentado perfeitamente.', 'success');
    } catch (err) {
        showStatus(`Erro interno de formatação do Prettier: ${err.message}`, 'error');
    }
}

// --- NOTIFICAÇÕES E STATUS ---
let statusTimer = null;

function showStatus(message, type = 'info') {
    const statusBar = document.getElementById('statusBar');
    if (!statusBar) return;

    if (statusTimer) {
        clearTimeout(statusTimer);
    }

    statusBar.textContent = message;
    statusBar.className = `status-bar ${type} show`;

    if (type !== 'error') {
        statusTimer = setTimeout(() => {
            statusBar.classList.remove('show');
        }, 4000);
    }
}
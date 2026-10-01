# JavaScript Formatter & Version Changer

Uma aplicação web para analisar, reformatar e fazer downgrade de versões do código JavaScript diretamente no navegador.

## Recursos

- **Validação de Sintaxe**: Verifica em tempo real se o código colado é JavaScript válido via Babel.
- **Checagem de Formatação**: Diagnostica se o código já atende aos padrões de indentação e estilo configurados.
- **Customização de Estilo**: Suporte para escolha de tamanho de indentação (espaços/tabs), aspas simples/duplas e ponto e vírgula obrigatório.
- **Downgrade de Versão**: Transpila o código moderno (ESNext) para versões legadas como **ES5** e **ES3**.

## Como Executar

Não requer compilação. Para rodar localmente com um servidor HTTP simples:

```bash
npm start
# Todo List Drive CSV

Versao estatica do TaskMaster usando um arquivo CSV no Google Drive como banco.

Esta copia nao usa Google Apps Script. Ela roda como site estatico no GitHub Pages e conversa direto com a Google Drive API pelo navegador.

## Como configurar

1. Crie um OAuth Client ID no Google Cloud:
   - Tipo: Web application
   - Authorized JavaScript origins:
     - `http://localhost:8000`
     - `https://brunopentium.github.io`
2. Ative a Google Drive API no projeto Google Cloud.
3. Abra `config.js` e substitua `COLE_SEU_CLIENT_ID_AQUI` pelo Client ID.
4. Publique estes arquivos em um repositorio novo, por exemplo `Todo-list-drive-csv`.
5. Ative o GitHub Pages usando a branch principal e a pasta raiz.

## Como usar

1. Abra o app.
2. Clique em `Conectar Drive`.
3. Clique em `Criar CSV no Drive` para o app criar `taskmaster-drive.csv`.
4. Edite tarefas normalmente.
5. Clique em `Salvar no Drive`.

O app usa o escopo `https://www.googleapis.com/auth/drive.file`, que permite gerenciar arquivos criados ou selecionados pelo app.

Se voce quiser abrir e editar um CSV que ja existia no seu Drive antes do app, talvez precise trocar `driveScope` em `config.js` para `https://www.googleapis.com/auth/drive`, porque o escopo `drive.file` e mais restrito.

## Colunas do CSV

`id,title,date,deadline,status,priority,difficulty,project,notes,tags,subtasks,recurrence,alertLevel,metadata`

Os campos `tags`, `subtasks`, `recurrence` e `metadata` sao serializados como texto/JSON.

## Migracao do app atual

1. Exporte a aba `Tarefas` do Google Sheets como CSV.
2. Abra este app novo.
3. Use `Importar CSV local`.
4. Conecte o Drive.
5. Clique em `Criar CSV no Drive` ou cole o ID de um CSV existente e salve.

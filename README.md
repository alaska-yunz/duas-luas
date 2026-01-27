## Bot de Discord – Registros, Aprovação e Ranking

Bot simples para:
- **Receber registros** dos usuários (`!registrar`)
- **Encaminhar para aprovação** em um canal específico (`!aprovar` / `!recusar`)
- **Atualizar um ranking** de usuários aprovados
- **Enviar devolutiva** (feedback) quando um registro é recusado

---

### 1. Pré-requisitos

- **Node.js** 18 ou superior instalado
- Uma **aplicação/bot** criada no painel de desenvolvedores do Discord

---

### 2. Configuração do bot no Discord

1. Acesse o site de desenvolvedores do Discord.
2. Crie uma **Application** e depois um **Bot**.
3. Copie o **Token** do bot.
4. Em **Privileged Gateway Intents**, ative:
   - Message Content Intent
   - Server Members Intent (se precisar)
5. Em **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissões: enviar mensagens, ler histórico etc.
   - Gere a URL, abra no navegador e adicione o bot ao seu servidor.

---

### 3. Configurar variáveis de ambiente

Na raiz do projeto, crie um arquivo chamado `.env` com o conteúdo:

```env
DISCORD_TOKEN=SEU_TOKEN_AQUI
GUILD_ID=ID_DO_SEU_SERVIDOR
CANAL_APROVACAO_ID=ID_DO_CANAL_DE_APROVACAO
```

- **DISCORD_TOKEN**: token do bot.
- **GUILD_ID**: ID do servidor (opcional para este exemplo, mas já deixado pronto).
- **CANAL_APROVACAO_ID**: ID do canal onde os moderadores vão aprovar/recusar.

Para pegar IDs, ative o **Developer Mode** no Discord e clique com o botão direito em servidor/canal → **Copy ID**.

---

### 4. Instalar dependências

No terminal, dentro da pasta do projeto:

```bash
npm install
```

Opcional para desenvolvimento com recarregamento automático:

```bash
npm run dev
```

---

### 5. Rodar o bot

```bash
npm start
```

Se tudo estiver correto, o bot ficará online no seu servidor.

---

### 6. Comandos disponíveis

- `!registrar <texto>`  
  Envia um registro para aprovação.  
  O bot manda o registro para o canal configurado em `CANAL_APROVACAO_ID`.

- `!aprovar <idRegistro>`  
  (Usado por moderadores)  
  Aprova o registro, adiciona ponto ao autor no ranking e manda DM avisando.

- `!recusar <idRegistro> <motivo>`  
  (Usado por moderadores)  
  Recusa o registro e envia uma devolutiva por DM ao autor com o motivo.

- `!ranking`  
  Mostra o top 10 usuários com mais pontos.

---

### 7. Limitações e próximos passos

- Os dados (registros pendentes e ranking) ficam **somente em memória**.  
  Quando o bot reinicia, o ranking é perdido.
- Próximos passos que você pode implementar:
  - Salvar o ranking em um arquivo JSON ou banco de dados.
  - Trocar comandos de texto por **slash commands** (`/registrar`, `/aprovar` etc.).
  - Adicionar mais campos ao registro (por exemplo, tipo de pedido, anexos etc.).


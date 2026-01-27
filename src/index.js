require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  addBlacklistEntry,
  markBlacklistRemoved,
  getBlacklistById,
} = require('./blacklistStore');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// "Banco de dados" simples em memória
const registrosPendentes = new Map(); // idRegistro -> { autorId, conteudo }
const ranking = new Map(); // userId -> pontos
let ultimoIdRegistro = 0;

function adicionarPonto(userId, pontos = 1) {
  const atual = ranking.get(userId) || 0;
  ranking.set(userId, atual + pontos);
}

function gerarRankingOrdenado() {
  return Array.from(ranking.entries()).sort((a, b) => b[1] - a[1]);
}

client.once('ready', () => {
  console.log(`Logado como ${client.user.tag}`);

  // Registra o slash command /registrar_blacklist apenas no servidor desejado
  const guildId = process.env.GUILD_ID;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.warn('Guild não encontrada para registrar comandos de barra. Verifique GUILD_ID.');
    return;
  }

  guild.commands
    .set([
      {
        name: 'registrar_blacklist',
        description: 'Registrar um membro na blacklist do servidor.',
        default_member_permissions: null, // vamos filtrar por cargo manualmente
        dm_permission: false,
        options: [
          {
            type: 3, // STRING
            name: 'id_passaporte',
            description: 'ID de passaporte da pessoa.',
            required: true,
          },
          {
            type: 3, // STRING
            name: 'nome',
            description: 'Nome da pessoa.',
            required: true,
          },
          {
            type: 3, // STRING
            name: 'motivo',
            description: 'Motivo do blacklist.',
            required: true,
          },
          {
            type: 3, // STRING
            name: 'data',
            description: 'Data do registro (ex: 25/01/2026 14:30). Deixe em branco para agora.',
            required: false,
          },
        ],
      },
    ])
    .then(() => console.log('Slash command /registrar_blacklist registrado.'))
    .catch((err) => console.error('Erro ao registrar comandos de barra:', err));
});

function formatDateBr(date) {
  const d = new Date(date);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const ano = d.getFullYear();
  const hora = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${ano} ${hora}:${min}`;
}

// IDs de cargos permitidos para usar e gerenciar blacklist (separe por vírgula no .env)
function getAllowedRoleIds() {
  const raw = process.env.BLACKLIST_ALLOWED_ROLES || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function memberHasAllowedRole(member) {
  const allowed = getAllowedRoleIds();
  if (!allowed.length) return false;
  return member.roles.cache.some((role) => allowed.includes(role.id));
}

// Tratamento de slash commands e botões/modais
client.on('interactionCreate', async (interaction) => {
  try {
    // Slash command /registrar_blacklist
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'registrar_blacklist') {
        const member = interaction.member;
        if (!memberHasAllowedRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para usar este comando.',
            ephemeral: true,
          });
        }

        const passportId = interaction.options.getString('id_passaporte', true);
        const nome = interaction.options.getString('nome', true);
        const motivo = interaction.options.getString('motivo', true);
        const dataManual = interaction.options.getString('data') || '';

        const blacklistChannelId = process.env.BLACKLIST_CHANNEL_ID;
        if (!blacklistChannelId) {
          return interaction.reply({
            content: 'Canal de blacklist não configurado. Defina BLACKLIST_CHANNEL_ID no .env.',
            ephemeral: true,
          });
        }

        const channel = await interaction.client.channels.fetch(blacklistChannelId);
        if (!channel || !channel.isTextBased()) {
          return interaction.reply({
            content: 'Canal de blacklist inválido. Verifique BLACKLIST_CHANNEL_ID.',
            ephemeral: true,
          });
        }

        const now = new Date();
        const dataTexto = dataManual.trim() ? dataManual.trim() : formatDateBr(now);
        const embed = new EmbedBuilder()
          .setTitle('🚫 Blacklist registrada')
          .setColor(0xff0000)
          .addFields(
            { name: 'ID Passaporte', value: passportId, inline: true },
            { name: 'Nome', value: nome, inline: true },
            { name: 'Motivo', value: motivo || 'Não informado.' },
            {
              name: 'Registrado por',
              value: `<@${interaction.user.id}> em ${dataTexto}`,
            },
          )
          .setTimestamp(now);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('placeholder') // será substituído depois de salvar o entry.id
            .setLabel('Remover blacklist')
            .setStyle(ButtonStyle.Danger),
        );

        // Primeiro respondemos de forma ephemera ao comando
        await interaction.reply({
          content: 'Registrando blacklist...',
          ephemeral: true,
        });

        // Envia mensagem no canal de blacklist
        const sentMessage = await channel.send({
          embeds: [embed],
          components: [row],
        });

        // Salva no "banco de dados"
        const entry = await addBlacklistEntry({
          passportId,
          nome,
          motivo,
          authorId: interaction.user.id,
          guildId: interaction.guildId,
          channelId: sentMessage.channelId,
          messageId: sentMessage.id,
        });

        // Atualiza o botão com o ID correto
        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`remove_blacklist:${entry.id}`)
            .setLabel('Remover blacklist')
            .setStyle(ButtonStyle.Danger),
        );

        await sentMessage.edit({
          components: [updatedRow],
        });

        await interaction.editReply({
          content: `Blacklist registrada para **${nome}** (ID Passaporte: ${passportId}).`,
        });
      }
    }

    // Clique no botão "Remover blacklist"
    if (interaction.isButton()) {
      const { customId } = interaction;
      if (customId.startsWith('remove_blacklist:')) {
        const member = interaction.member;
        if (!memberHasAllowedRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para remover blacklist.',
            ephemeral: true,
          });
        }

        const entryId = customId.split(':')[1];
        const entry = await getBlacklistById(entryId);
        if (!entry) {
          return interaction.reply({
            content: 'Registro de blacklist não encontrado.',
            ephemeral: true,
          });
        }

        if (entry.removed) {
          return interaction.reply({
            content: 'Este registro de blacklist já foi removido.',
            ephemeral: true,
          });
        }

        // Abre modal para coletar motivo da remoção
        const modal = new ModalBuilder()
          .setCustomId(`confirm_remove_blacklist:${entryId}`)
          .setTitle('Remover blacklist');

        const reasonInput = new TextInputBuilder()
          .setCustomId('remove_reason')
          .setLabel('Motivo da remoção')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500);

        const modalRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(modalRow);

        await interaction.showModal(modal);
      }
    }

    // Submissão do modal de remoção de blacklist
    if (interaction.isModalSubmit()) {
      const { customId } = interaction;
      if (customId.startsWith('confirm_remove_blacklist:')) {
        const entryId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasAllowedRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para remover blacklist.',
            ephemeral: true,
          });
        }

        const reason = interaction.fields.getTextInputValue('remove_reason');
        const updated = await markBlacklistRemoved(entryId, {
          removedBy: interaction.user.id,
          reason,
        });

        if (!updated) {
          return interaction.reply({
            content: 'Registro de blacklist não encontrado.',
            ephemeral: true,
          });
        }

        // Edita a mensagem original no canal de blacklist (se possível)
        try {
          const channel = await interaction.client.channels.fetch(updated.channelId);
          if (channel && channel.isTextBased()) {
            const msg = await channel.messages.fetch(updated.messageId).catch(() => null);
            if (msg) {
              const originalEmbed = msg.embeds[0];
              const removedDate = new Date();
              const removedEmbed = EmbedBuilder.from(originalEmbed)
                .setTitle('✅ Blacklist removida')
                .setColor(0x00ff00)
                .addFields(
                  {
                    name: 'Removido por',
                    value: `<@${interaction.user.id}> em ${formatDateBr(removedDate)}`,
                    inline: true,
                  },
                  {
                    name: 'Motivo da remoção',
                    value: reason || 'Não informado.',
                  },
                )
                .setTimestamp(removedDate);

              const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`remove_blacklist:${entryId}`)
                  .setLabel('Blacklist removida')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true),
              );

              await msg.edit({
                embeds: [removedEmbed],
                components: [disabledRow],
              });
            }
          }
        } catch (err) {
          console.error('Erro ao atualizar mensagem de blacklist removida:', err);
        }

        await interaction.reply({
          content: 'Blacklist removida com sucesso.',
          ephemeral: true,
        });
      }
    }
  } catch (err) {
    console.error('Erro em interactionCreate:', err);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({
        content: 'Ocorreu um erro ao processar a interação.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

// Comandos de texto simples: !registrar, !aprovar, !recusar, !ranking
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const prefixo = '!';
  if (!message.content.startsWith(prefixo)) return;

  const [comando, ...args] = message.content
    .slice(prefixo.length)
    .trim()
    .split(/\s+/);

  // !registrar <texto do registro>
  if (comando === 'registrar') {
    const conteudo = args.join(' ');
    if (!conteudo) {
      return message.reply('Use: `!registrar <seu registro>`');
    }

    ultimoIdRegistro += 1;
    const idRegistro = ultimoIdRegistro.toString();

    registrosPendentes.set(idRegistro, {
      autorId: message.author.id,
      conteudo,
    });

    // Envia para canal de aprovação
    try {
      const canalAprovacao = await client.channels.fetch(process.env.CANAL_APROVACAO_ID);
      if (canalAprovacao && canalAprovacao.isTextBased()) {
        await canalAprovacao.send(
          `Novo registro pendente #${idRegistro}:\n` +
            `Autor: <@${message.author.id}>\n` +
            `Conteúdo: ${conteudo}\n\n` +
            `Use \`!aprovar ${idRegistro}\` ou \`!recusar ${idRegistro} <motivo>\`.`,
        );
      }
    } catch (error) {
      console.error('Erro ao enviar para canal de aprovação:', error);
    }

    return message.reply(`Seu registro foi enviado para aprovação com ID **#${idRegistro}**.`);
  }

  // !aprovar <idRegistro>
  if (comando === 'aprovar') {
    const [idRegistro] = args;
    if (!idRegistro) {
      return message.reply('Use: `!aprovar <idRegistro>`');
    }

    const registro = registrosPendentes.get(idRegistro);
    if (!registro) {
      return message.reply('Registro não encontrado ou já processado.');
    }

    registrosPendentes.delete(idRegistro);

    // Atualiza ranking
    adicionarPonto(registro.autorId, 1);

    // Feedback para o autor
    try {
      const autor = await client.users.fetch(registro.autorId);
      await autor.send(
        `Seu registro **#${idRegistro}** foi **aprovado**!\n` +
          `Conteúdo: ${registro.conteudo}`,
      );
    } catch (e) {
      console.error('Falha ao enviar DM:', e);
    }

    return message.reply(`Registro #${idRegistro} aprovado e ranking atualizado.`);
  }

  // !recusar <idRegistro> <motivo...>
  if (comando === 'recusar') {
    const [idRegistro, ...motivoPartes] = args;
    if (!idRegistro) {
      return message.reply('Use: `!recusar <idRegistro> <motivo>`');
    }

    const registro = registrosPendentes.get(idRegistro);
    if (!registro) {
      return message.reply('Registro não encontrado ou já processado.');
    }

    const motivo = motivoPartes.join(' ') || 'Sem motivo especificado.';
    registrosPendentes.delete(idRegistro);

    // Feedback para o autor
    try {
      const autor = await client.users.fetch(registro.autorId);
      await autor.send(
        `Seu registro **#${idRegistro}** foi **recusado**.\n` +
          `Motivo: ${motivo}\n` +
          `Conteúdo enviado: ${registro.conteudo}`,
      );
    } catch (e) {
      console.error('Falha ao enviar DM:', e);
    }

    return message.reply(`Registro #${idRegistro} recusado. Devolutiva enviada ao autor.`);
  }

  // !ranking
  if (comando === 'ranking') {
    const lista = gerarRankingOrdenado();
    if (lista.length === 0) {
      return message.reply('Ainda não há ninguém no ranking.');
    }

    const linhas = await Promise.all(
      lista.slice(0, 10).map(async ([userId, pontos], idx) => {
        return `${idx + 1}. <@${userId}> — **${pontos}** ponto(s)`;
      }),
    );

    return message.reply('🏆 **Ranking**:\n' + linhas.join('\n'));
  }
});

client.login(process.env.DISCORD_TOKEN);


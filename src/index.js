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
  UserSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const {
  addBlacklistEntry,
  markBlacklistRemoved,
  getBlacklistById,
  getActiveBlacklistByPassport,
} = require('./blacklistStore');
const {
  generateId: generateRecruitId,
  addRecruit,
  updateRecruitStatus,
  getRecruitById,
  getRecruitRanking,
  markKitDelivered,
  adjustRankingPoints,
} = require('./recruitStore');

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

// Helper para verificar se a interação já foi respondida
function isInteractionResponded(interaction) {
  return interaction.replied || interaction.deferred;
}

// Helper para responder a interação com tratamento de erros
async function safeReply(interaction, options) {
  if (isInteractionResponded(interaction)) {
    console.warn('Tentativa de responder interação já respondida:', interaction.customId || interaction.commandName);
    return;
  }
  try {
    return await interaction.reply(options);
  } catch (err) {
    if (err.code === 10062) {
      // Unknown interaction - interação expirada
      console.warn('Interação expirada (10062):', interaction.customId || interaction.commandName);
      return;
    }
    if (err.code === 40060) {
      // Interaction already acknowledged
      console.warn('Interação já foi reconhecida (40060):', interaction.customId || interaction.commandName);
      return;
    }
    throw err;
  }
}

function adicionarPonto(userId, pontos = 1) {
  const atual = ranking.get(userId) || 0;
  ranking.set(userId, atual + pontos);
}

function gerarRankingOrdenado() {
  return Array.from(ranking.entries()).sort((a, b) => b[1] - a[1]);
}

client.once('ready', async () => {
  console.log(`Logado como ${client.user.tag}`);

  // Registra o slash command /registrar_blacklist apenas no servidor desejado
  const guildId = process.env.GUILD_ID;
  console.log(`Tentando registrar comandos na guild: ${guildId}`);
  
  if (!guildId) {
    console.error('GUILD_ID não configurado no .env!');
    return;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.warn('Guild não encontrada no cache. Tentando buscar...');
    try {
      const fetchedGuild = await client.guilds.fetch(guildId);
      console.log(`Guild encontrada: ${fetchedGuild.name}`);
      
      await fetchedGuild.commands.set([
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
        {
          name: 'inserir_painel_recrutamento',
          description: 'Envia um bloco com botão para solicitar set no Duas Luas.',
          dm_permission: false,
        },
        {
          name: 'ranking_recrutamento',
          description: 'Mostra o ranking de recrutamento dos membros.',
          dm_permission: false,
        },
        {
          name: 'adicionar_recrutamento',
          description: 'Adiciona pontos ao ranking de recrutamento (apenas para cargos autorizados).',
          dm_permission: false,
          options: [
            {
              type: 6, // USER
              name: 'recrutador',
              description: 'O recrutador que receberá os pontos.',
              required: true,
            },
            {
              type: 4, // INTEGER
              name: 'quantidade',
              description: 'Quantidade de pontos a adicionar.',
              required: true,
            },
          ],
        },
        {
          name: 'remover_recrutamento',
          description: 'Remove pontos do ranking de recrutamento (apenas para cargos autorizados).',
          dm_permission: false,
          options: [
            {
              type: 6, // USER
              name: 'recrutador',
              description: 'O recrutador que perderá os pontos.',
              required: true,
            },
            {
              type: 4, // INTEGER
              name: 'quantidade',
              description: 'Quantidade de pontos a remover.',
              required: true,
            },
          ],
        },
      ]);
      console.log('Slash commands registrados com sucesso!');
    } catch (err) {
      console.error('Erro ao buscar/registrar comandos:', err);
    }
    return;
  }

  try {
    await guild.commands.set([
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
      {
        name: 'inserir_painel_recrutamento',
        description: 'Envia um bloco com botão para solicitar set no Duas Luas.',
        dm_permission: false,
      },
      {
        name: 'ranking_recrutamento',
        description: 'Mostra o ranking de recrutamento dos membros.',
        dm_permission: false,
      },
      {
        name: 'adicionar_recrutamento',
        description: 'Adiciona pontos ao ranking de recrutamento (apenas para cargos autorizados).',
        dm_permission: false,
        options: [
          {
            type: 6, // USER
            name: 'recrutador',
            description: 'O recrutador que receberá os pontos.',
            required: true,
          },
          {
            type: 4, // INTEGER
            name: 'quantidade',
            description: 'Quantidade de pontos a adicionar.',
            required: true,
          },
        ],
      },
      {
        name: 'remover_recrutamento',
        description: 'Remove pontos do ranking de recrutamento (apenas para cargos autorizados).',
        dm_permission: false,
        options: [
          {
            type: 6, // USER
            name: 'recrutador',
            description: 'O recrutador que perderá os pontos.',
            required: true,
          },
          {
            type: 4, // INTEGER
            name: 'quantidade',
            description: 'Quantidade de pontos a remover.',
            required: true,
          },
        ],
      },
    ]);
    console.log('Slash commands registrados com sucesso!');
  } catch (err) {
    console.error('Erro ao registrar comandos de barra:', err);
  }
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

// Cargos que podem gerenciar recrutamento (gerentes / gerentes de elite)
function getRecruitManagerRoleIds() {
  const raw = process.env.RECRUIT_MANAGER_ROLES || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function memberHasRecruitManagerRole(member) {
  const allowed = getRecruitManagerRoleIds();
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
            flags: MessageFlags.Ephemeral,
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
            flags: MessageFlags.Ephemeral,
          });
        }

        const channel = await interaction.client.channels.fetch(blacklistChannelId);
        if (!channel || !channel.isTextBased()) {
          return interaction.reply({
            content: 'Canal de blacklist inválido. Verifique BLACKLIST_CHANNEL_ID.',
            flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
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
      } else if (interaction.commandName === 'inserir_painel_recrutamento') {
        const member = interaction.member;
        if (!memberHasRecruitManagerRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para enviar o painel de recrutamento.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const embed = new EmbedBuilder()
          .setTitle('Recrutamento Duas Luas 🌙')
          .setDescription(
            'Esse é o seu primeiro passo para fazer parte da família Duas Luas!\n\n' +
              'Clique no botão abaixo para solicitar o seu set de membro e preencher o formulário.',
          )
          .setImage('https://media.discordapp.net/attachments/1277186639969517642/1443073749015466004/file.jpg')
          .setColor(0x3498db);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_recruit_request')
            .setLabel('Solicitar set')
            .setStyle(ButtonStyle.Primary),
        );

        await interaction.reply({
          embeds: [embed],
          components: [row],
        });
      } else if (interaction.commandName === 'ranking_recrutamento') {
        const ranking = await getRecruitRanking(10);
        if (!ranking.length) {
          return interaction.reply({
            content: 'Ainda não há recrutamentos aprovados.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const linhas = await Promise.all(
          ranking.map(async ({ recruiterId, total }, idx) => {
            return `${idx + 1}. <@${recruiterId}> — **${total}** recrutamento(s) aprovado(s)`;
          }),
        );

        const embed = new EmbedBuilder()
          .setTitle('🏆 Ranking de Recrutamento - Duas Luas')
          .setDescription(linhas.join('\n'))
          .setColor(0xf1c40f);

        await interaction.reply({ embeds: [embed] });
      } else if (interaction.commandName === 'adicionar_recrutamento') {
        const member = interaction.member;
        if (!memberHasAllowedRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para adicionar pontos ao ranking.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const recruiter = interaction.options.getUser('recrutador', true);
        const quantidade = interaction.options.getInteger('quantidade', true);

        if (quantidade <= 0) {
          return interaction.reply({
            content: 'A quantidade deve ser maior que zero.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const result = await adjustRankingPoints(recruiter.id, quantidade, interaction.user.id);

        if (!result.success) {
          return interaction.reply({
            content: result.message || 'Erro ao adicionar pontos ao ranking.',
            flags: MessageFlags.Ephemeral,
          });
        }

        await interaction.reply({
          content: `${result.message}\nRecrutador: <@${recruiter.id}>\nQuantidade: **${quantidade}** ponto(s)`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.commandName === 'remover_recrutamento') {
        const member = interaction.member;
        if (!memberHasAllowedRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para remover pontos do ranking.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const recruiter = interaction.options.getUser('recrutador', true);
        const quantidade = interaction.options.getInteger('quantidade', true);

        if (quantidade <= 0) {
          return interaction.reply({
            content: 'A quantidade deve ser maior que zero.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const result = await adjustRankingPoints(recruiter.id, -quantidade, interaction.user.id);

        if (!result.success) {
          return interaction.reply({
            content: result.message || 'Erro ao remover pontos do ranking.',
            flags: MessageFlags.Ephemeral,
          });
        }

        await interaction.reply({
          content: `${result.message}\nRecrutador: <@${recruiter.id}>\nQuantidade: **${quantidade}** ponto(s)`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // Clique no botão "Remover blacklist" / fluxo de recrutamento
    if (interaction.isButton()) {
      const { customId } = interaction;
      if (customId.startsWith('remove_blacklist:')) {
        const member = interaction.member;
        if (!memberHasAllowedRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para remover blacklist.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const entryId = customId.split(':')[1];
        const entry = await getBlacklistById(entryId);
        if (!entry) {
          return interaction.reply({
            content: 'Registro de blacklist não encontrado.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (entry.removed) {
          return interaction.reply({
            content: 'Este registro de blacklist já foi removido.',
            flags: MessageFlags.Ephemeral,
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
      } else if (customId === 'open_recruit_request') {
        // Abre seletor de recrutador
        const row = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId('select_recruiter')
            .setPlaceholder('Selecione quem foi o seu recrutador')
            .setMinValues(1)
            .setMaxValues(1),
        );

        await interaction.reply({
          content: 'Selecione abaixo quem foi o seu recrutador:',
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
      } else if (customId.startsWith('approve_recruit:')) {
        const recruitId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasRecruitManagerRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para aprovar recrutamento.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const recruit = await getRecruitById(recruitId);
        if (!recruit) {
          return interaction.reply({
            content: 'Recrutamento não encontrado.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (recruit.status === 'approved') {
          return interaction.reply({
            content: 'Este recrutamento já foi aprovado.',
            flags: MessageFlags.Ephemeral,
          });
        }
        if (recruit.status === 'rejected') {
          return interaction.reply({
            content: 'Este recrutamento já foi reprovado.',
            flags: MessageFlags.Ephemeral,
          });
        }

        // Modal com perguntas sobre primeiras atividades
        const modal = new ModalBuilder()
          .setCustomId(`approve_recruit_modal:${recruitId}`)
          .setTitle('Aprovar recrutamento');

        const corridaInput = new TextInputBuilder()
          .setCustomId('primeira_corrida')
          .setLabel('O membro realizou sua primeira corrida?')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const farmInput = new TextInputBuilder()
          .setCustomId('primeiro_farm')
          .setLabel('O membro entregou o primeiro farm?')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const desmancheInput = new TextInputBuilder()
          .setCustomId('primeiro_desmanche')
          .setLabel('O membro realizou o primeiro desmanche?')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const row1 = new ActionRowBuilder().addComponents(corridaInput);
        const row2 = new ActionRowBuilder().addComponents(farmInput);
        const row3 = new ActionRowBuilder().addComponents(desmancheInput);

        modal.addComponents(row1, row2, row3);

        await interaction.showModal(modal);
      } else if (customId.startsWith('reject_recruit:')) {
        const recruitId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasRecruitManagerRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para reprovar recrutamento.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const recruit = await getRecruitById(recruitId);
        if (!recruit) {
          return interaction.reply({
            content: 'Recrutamento não encontrado.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (recruit.status === 'approved') {
          return interaction.reply({
            content: 'Este recrutamento já foi aprovado.',
            flags: MessageFlags.Ephemeral,
          });
        }
        if (recruit.status === 'rejected') {
          return interaction.reply({
            content: 'Este recrutamento já foi reprovado.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`reject_recruit_modal:${recruitId}`)
          .setTitle('Reprovar recrutamento');

        const reasonInput = new TextInputBuilder()
          .setCustomId('motivo_reprovacao')
          .setLabel('Motivo da reprovação')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500);

        const row = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
      } else if (customId.startsWith('kit_delivered:')) {
        const recruitId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasRecruitManagerRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para marcar kit como entregue.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const recruit = await getRecruitById(recruitId);
        if (!recruit) {
          return interaction.reply({
            content: 'Recrutamento não encontrado.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (recruit.status !== 'approved') {
          return interaction.reply({
            content: 'Apenas recrutamentos aprovados podem ter o kit marcado como entregue.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (recruit.kitDelivered) {
          return interaction.reply({
            content: 'O kit inicial já foi marcado como entregue.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const updated = await markKitDelivered(recruitId, interaction.user.id);

        // Atualiza mensagem de aprovação
        try {
          const channel = await interaction.client.channels.fetch(updated.approvalChannelId);
          if (channel && channel.isTextBased()) {
            const msg = await channel.messages.fetch(updated.approvalMessageId).catch(() => null);
            if (msg) {
              const originalEmbed = msg.embeds[0];
              const now = new Date();
              const embed = EmbedBuilder.from(originalEmbed).addFields({
                name: 'Kit inicial entregue',
                value: `<@${interaction.user.id}> em ${formatDateBr(now)}`,
              });

              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`approve_recruit:${recruitId}`)
                  .setLabel('Aprovado')
                  .setStyle(ButtonStyle.Success)
                  .setDisabled(true),
                new ButtonBuilder()
                  .setCustomId(`reject_recruit:${recruitId}`)
                  .setLabel('Reprovado')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true),
                new ButtonBuilder()
                  .setCustomId(`kit_delivered:${recruitId}`)
                  .setLabel('Kit inicial entregue')
                  .setStyle(ButtonStyle.Success)
                  .setDisabled(true),
              );

              await msg.edit({ embeds: [embed], components: [row] });
            }
          }
        } catch (err) {
          console.error('Erro ao atualizar mensagem de kit entregue:', err);
        }

        await interaction.reply({
          content: 'Kit inicial marcado como entregue.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // Menus de seleção (recrutador)
    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === 'select_recruiter') {
        try {
          const recruiterId = interaction.values[0];

          const modal = new ModalBuilder()
            .setCustomId(`recruit_modal:${recruiterId}`)
            .setTitle('Solicitar set - Duas Luas');

          const nameInput = new TextInputBuilder()
            .setCustomId('nome_sobrenome')
            .setLabel('Nome e Sobrenome (in-game)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          const phoneInput = new TextInputBuilder()
            .setCustomId('telefone_ingame')
            .setLabel('Telefone in-game (não use número real)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          const passportInput = new TextInputBuilder()
            .setCustomId('passaporte_ingame')
            .setLabel('Passaporte in-game (veja no F11)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          const row1 = new ActionRowBuilder().addComponents(nameInput);
          const row2 = new ActionRowBuilder().addComponents(phoneInput);
          const row3 = new ActionRowBuilder().addComponents(passportInput);

          modal.addComponents(row1, row2, row3);

          await interaction.showModal(modal);
        } catch (err) {
          if (err.code === 10062) {
            console.warn('Interação expirada ao mostrar modal de recrutamento');
            return;
          }
          console.error('Erro ao mostrar modal de recrutamento:', err);
          if (!isInteractionResponded(interaction)) {
            await safeReply(interaction, {
              content: 'Ocorreu um erro ao abrir o formulário. Tente novamente.',
              flags: MessageFlags.Ephemeral,
            });
          }
        }
      }
    }

    // Submissão de modais (remoção de blacklist / recrutamento)
    if (interaction.isModalSubmit()) {
      const { customId } = interaction;
      if (customId.startsWith('confirm_remove_blacklist:')) {
        const entryId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasAllowedRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para remover blacklist.',
            flags: MessageFlags.Ephemeral,
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
            flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
        });
      } else if (customId.startsWith('recruit_modal:')) {
        const recruiterId = customId.split(':')[1];
        const candidateId = interaction.user.id;

        const nomeCompleto = interaction.fields.getTextInputValue('nome_sobrenome');
        const telefone = interaction.fields.getTextInputValue('telefone_ingame');
        const passaporte = interaction.fields.getTextInputValue('passaporte_ingame');

        // Atualiza o apelido (nickname) do membro para "Nome Sobrenome | Passaporte" e adiciona cargo de olheiro
        try {
          const guild = interaction.guild;
          if (!guild) {
            console.error('Guild não encontrada ao processar recrutamento');
          } else {
            const guildMember = await guild.members.fetch(candidateId).catch((err) => {
              console.error(`Erro ao buscar membro ${candidateId}:`, err);
              return null;
            });

            if (!guildMember) {
              console.error(`Membro ${candidateId} não encontrado no servidor`);
            } else {

          console.log(`Processando recrutamento para membro: ${guildMember.user.tag} (${candidateId})`);

          // Atualiza nickname
          const newNickname = `${nomeCompleto} | ${passaporte}`;
          const truncatedNickname = newNickname.length > 32 ? newNickname.substring(0, 29) + '...' : newNickname;
          
          try {
            await guildMember.setNickname(truncatedNickname);
            console.log(`✓ Nickname atualizado para ${guildMember.user.tag}: ${truncatedNickname}`);
          } catch (err) {
            console.error('Erro ao atualizar nickname do membro:', err.message);
          }

            // Adiciona cargo de olheiro
            const olheiroRoleId = process.env.ROLE_OLHEIRO_ID;
            if (!olheiroRoleId) {
              console.warn('⚠ ROLE_OLHEIRO_ID não configurado no .env');
            } else {
              try {
                const role = await guild.roles.fetch(olheiroRoleId).catch(() => null);
                if (!role) {
                  console.error(`❌ Cargo de olheiro não encontrado com ID: ${olheiroRoleId}`);
                } else {
                  // Verifica se o bot tem permissão para gerenciar cargos
                  const botMember = await guild.members.fetch(interaction.client.user.id);
                  if (!botMember.permissions.has('ManageRoles')) {
                    console.error('❌ Bot não tem permissão "Gerenciar Cargos" no servidor');
                    console.error('Por favor, dê a permissão "Gerenciar Cargos" ao bot nas configurações do servidor');
                  } else if (role.position >= botMember.roles.highest.position) {
                    console.error(`❌ O cargo de olheiro (${role.name}) está acima ou igual ao cargo mais alto do bot`);
                    console.error('O bot precisa ter um cargo acima do cargo de olheiro para poder atribuí-lo');
                  } else {
                    if (!guildMember.roles.cache.has(olheiroRoleId)) {
                      await guildMember.roles.add(olheiroRoleId);
                      console.log(`✓ Cargo de olheiro adicionado para ${guildMember.user.tag}`);
                    } else {
                      console.log(`ℹ ${guildMember.user.tag} já possui o cargo de olheiro`);
                    }
                  }
                }
              } catch (err) {
                if (err.code === 50013) {
                  console.error('❌ Erro de permissão ao adicionar cargo de olheiro:');
                  console.error('   - Verifique se o bot tem a permissão "Gerenciar Cargos"');
                  console.error('   - Verifique se o cargo do bot está acima do cargo de olheiro na hierarquia');
                } else {
                  console.error('Erro ao adicionar cargo de olheiro:', err.message);
                  console.error('Stack:', err.stack);
                }
              }
            }
            }
          }
        } catch (err) {
          console.error('Erro geral ao atualizar nickname/cargo do membro:', err);
          console.error('Stack:', err.stack);
        }

        const approvalChannelId = process.env.RECRUIT_APPROVAL_CHANNEL_ID;
        if (!approvalChannelId) {
          return interaction.reply({
            content:
              'Canal de aprovações de recrutamento não configurado. Defina RECRUIT_APPROVAL_CHANNEL_ID no .env.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const guild = interaction.guild;
        const approvalChannel = await interaction.client.channels.fetch(approvalChannelId);
        if (!approvalChannel || !approvalChannel.isTextBased()) {
          return interaction.reply({
            content:
              'Canal de aprovações de recrutamento inválido. Verifique RECRUIT_APPROVAL_CHANNEL_ID.',
            flags: MessageFlags.Ephemeral,
          });
        }

        // Checa blacklist pelo passaporte
        const blacklistEntry = await getActiveBlacklistByPassport(passaporte);

        const recruitId = generateRecruitId();

        const embed = new EmbedBuilder()
          .setTitle('📝 Novo pedido de set')
          .setColor(0x9b59b6)
          .addFields(
            { name: 'Recrutador', value: `<@${recruiterId}>`, inline: true },
            { name: 'Candidato', value: `<@${candidateId}>`, inline: true },
            { name: 'Nome', value: nomeCompleto, inline: false },
            { name: 'Telefone in-game', value: telefone, inline: true },
            { name: 'Passaporte in-game', value: passaporte, inline: true },
          )
          .setTimestamp(new Date());

        if (blacklistEntry) {
          embed.addFields({
            name: '⚠ Atenção: em blacklist',
            value: `Este passaporte está em blacklist.\nMotivo: **${blacklistEntry.motivo}**`,
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`approve_recruit:${recruitId}`)
            .setLabel('Aprovar recrutamento')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`reject_recruit:${recruitId}`)
            .setLabel('Reprovar recrutamento')
            .setStyle(ButtonStyle.Danger),
        );

        const approvalMessage = await approvalChannel.send({
          embeds: [embed],
          components: [row],
        });

        await addRecruit({
          id: recruitId,
          recruiterId,
          candidateId,
          candidateName: nomeCompleto,
          phone: telefone,
          passport: passaporte,
          blacklistFlag: !!blacklistEntry,
          blacklistReason: blacklistEntry ? blacklistEntry.motivo : null,
          approvalChannelId: approvalChannel.id,
          approvalMessageId: approvalMessage.id,
        });

        await interaction.reply({
          content: 'Seu pedido de set foi enviado para aprovação.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (customId.startsWith('approve_recruit_modal:')) {
        const recruitId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasRecruitManagerRole(member)) {
          return await safeReply(interaction, {
            content: 'Você não tem permissão para aprovar recrutamento.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const recruit = await getRecruitById(recruitId);
        if (!recruit) {
          return await safeReply(interaction, {
            content: 'Recrutamento não encontrado.',
            flags: MessageFlags.Ephemeral,
          });
        }

        // Verifica se já foi aprovado para evitar processamento duplicado
        if (recruit.status === 'approved') {
          return await safeReply(interaction, {
            content: 'Este recrutamento já foi aprovado anteriormente.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (recruit.status === 'rejected') {
          return await safeReply(interaction, {
            content: 'Este recrutamento já foi reprovado e não pode ser aprovado.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const primeiraCorrida = interaction.fields.getTextInputValue('primeira_corrida');
        const primeiroFarm = interaction.fields.getTextInputValue('primeiro_farm');
        const primeiroDesmanche = interaction.fields.getTextInputValue('primeiro_desmanche');

        let updated;
        try {
          updated = await updateRecruitStatus(recruitId, {
            status: 'approved',
            approvedBy: interaction.user.id,
            firstRace: primeiraCorrida,
            firstFarm: primeiroFarm,
            firstDismantle: primeiroDesmanche,
          });

          if (!updated) {
            return await safeReply(interaction, {
              content: 'Erro ao atualizar status do recrutamento no banco de dados.',
              flags: MessageFlags.Ephemeral,
            });
          }
        } catch (err) {
          console.error('Erro ao atualizar status do recrutamento:', err);
          console.error('Stack trace:', err.stack);
          console.error('Recruit ID:', recruitId);
          console.error('Status:', 'approved');
          console.error('Dados:', { primeiraCorrida, primeiroFarm, primeiroDesmanche });
          return await safeReply(interaction, {
            content: `Erro ao atualizar status do recrutamento: ${err.message || 'Erro desconhecido'}. Verifique os logs do bot.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // Atualiza cargos do membro (remove olheiro, adiciona membro)

        // Atualiza cargos do membro (remove olheiro, adiciona membro)
        try {
          const guild = interaction.guild;
          const guildMember = await guild.members.fetch(recruit.candidateId).catch(() => null);
          if (guildMember) {
            const olheiroRoleId = process.env.ROLE_OLHEIRO_ID;
            const membroRoleId = process.env.ROLE_MEMBRO_ID;

            // Verifica permissões do bot
            const botMember = await guild.members.fetch(interaction.client.user.id);
            const hasManageRoles = botMember.permissions.has('ManageRoles');

            if (!hasManageRoles) {
              console.error('❌ Bot não tem permissão "Gerenciar Cargos" no servidor');
              console.error('Por favor, dê a permissão "Gerenciar Cargos" ao bot nas configurações do servidor');
            } else {
              // Remove cargo de olheiro (se tiver)
              if (olheiroRoleId) {
                try {
                  const olheiroRole = await guild.roles.fetch(olheiroRoleId).catch(() => null);
                  if (olheiroRole && olheiroRole.position < botMember.roles.highest.position) {
                    if (guildMember.roles.cache.has(olheiroRoleId)) {
                      await guildMember.roles.remove(olheiroRoleId);
                      console.log(`✓ Cargo de olheiro removido de ${guildMember.user.tag}`);
                    }
                  } else if (olheiroRole) {
                    console.error(`❌ Cargo de olheiro está acima do cargo do bot na hierarquia`);
                  }
                } catch (err) {
                  if (err.code === 50013) {
                    console.error('❌ Sem permissão para remover cargo de olheiro');
                  } else {
                    console.error('Erro ao remover cargo de olheiro:', err.message);
                  }
                }
              }

              // Adiciona cargo de membro
              if (membroRoleId) {
                try {
                  const membroRole = await guild.roles.fetch(membroRoleId).catch(() => null);
                  if (!membroRole) {
                    console.error(`❌ Cargo de membro não encontrado com ID: ${membroRoleId}`);
                  } else if (membroRole.position >= botMember.roles.highest.position) {
                    console.error(`❌ O cargo de membro (${membroRole.name}) está acima ou igual ao cargo mais alto do bot`);
                    console.error('O bot precisa ter um cargo acima do cargo de membro para poder atribuí-lo');
                  } else {
                    if (!guildMember.roles.cache.has(membroRoleId)) {
                      await guildMember.roles.add(membroRoleId);
                      console.log(`✓ Cargo de membro adicionado para ${guildMember.user.tag}`);
                    } else {
                      console.log(`ℹ ${guildMember.user.tag} já possui o cargo de membro`);
                    }
                  }
                } catch (err) {
                  if (err.code === 50013) {
                    console.error('❌ Erro de permissão ao adicionar cargo de membro:');
                    console.error('   - Verifique se o bot tem a permissão "Gerenciar Cargos"');
                    console.error('   - Verifique se o cargo do bot está acima do cargo de membro na hierarquia');
                  } else {
                    console.error('Erro ao adicionar cargo de membro:', err.message);
                  }
                }
              } else {
                console.warn('⚠ ROLE_MEMBRO_ID não configurado no .env');
              }
            }
          } else {
            console.warn(`Membro ${recruit.candidateId} não encontrado no servidor`);
          }
        } catch (err) {
          console.error('Erro ao atualizar cargos do membro aprovado:', err);
          if (err.code === 50013) {
            console.error('❌ Erro de permissão: O bot precisa ter a permissão "Gerenciar Cargos"');
          }
        }

        // Atualiza mensagem de aprovação
        try {
          const approvalChannelId = recruit.approvalChannelId || updated?.approvalChannelId;
          const approvalMessageId = recruit.approvalMessageId || updated?.approvalMessageId;

          if (approvalChannelId && approvalMessageId) {
            const channel = await interaction.client.channels.fetch(approvalChannelId);
            if (channel && channel.isTextBased()) {
              const msg = await channel.messages.fetch(approvalMessageId).catch(() => null);
              if (msg && msg.embeds && msg.embeds.length > 0) {
                const now = new Date();
                const originalEmbed = msg.embeds[0];
                let embed;
                try {
                  embed = EmbedBuilder.from(originalEmbed);
                } catch (embedErr) {
                  console.error('Erro ao criar embed a partir do original:', embedErr);
                  // Cria um novo embed se não conseguir usar o original
                  embed = new EmbedBuilder()
                    .setTitle('📝 Recrutamento')
                    .setColor(0x2ecc71);
                }
                
                embed
                  .setColor(0x2ecc71)
                  .addFields(
                    {
                      name: 'Status',
                      value: '✅ Aprovado',
                    },
                    {
                      name: 'Aprovado por',
                      value: `<@${interaction.user.id}> em ${formatDateBr(now)}`,
                    },
                    {
                      name: 'Primeira corrida',
                      value: primeiraCorrida || 'Não informado',
                      inline: true,
                    },
                    {
                      name: 'Primeiro farm',
                      value: primeiroFarm || 'Não informado',
                      inline: true,
                    },
                    {
                      name: 'Primeiro desmanche',
                      value: primeiroDesmanche || 'Não informado',
                      inline: true,
                    },
                  )
                  .setTimestamp(now);

              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`approve_recruit:${recruitId}`)
                  .setLabel('Aprovado')
                  .setStyle(ButtonStyle.Success)
                  .setDisabled(true),
                new ButtonBuilder()
                  .setCustomId(`reject_recruit:${recruitId}`)
                  .setLabel('Reprovado')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true),
                new ButtonBuilder()
                  .setCustomId(`kit_delivered:${recruitId}`)
                  .setLabel('Kit inicial entregue')
                  .setStyle(ButtonStyle.Primary),
              );

              await msg.edit({ embeds: [embed], components: [row] });
            }
          }
          }
        } catch (err) {
          console.error('Erro ao atualizar mensagem de aprovação de recrutamento:', err);
        }

        // Mensagem de boas-vindas (apenas se não foi aprovado antes)
        try {
          const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
          if (welcomeChannelId) {
            const welcomeChannel = await interaction.client.channels.fetch(welcomeChannelId);
            if (welcomeChannel && welcomeChannel.isTextBased()) {
              const user = await interaction.client.users.fetch(recruit.candidateId);
              const avatarUrl = user.displayAvatarURL({ size: 256 });

              const welcomeEmbed = new EmbedBuilder()
                .setTitle('Bem vindo(a) ao Duas Luas!')
                .setThumbnail(avatarUrl)
                .setColor(0xe91e63);

              console.log(`Enviando mensagem de boas-vindas para ${user.tag} (${recruit.candidateId})`);
              const welcomeMessage = await welcomeChannel.send({
                content: `<@${recruit.candidateId}> seja bem vindo(a) ao Duas Luas!`,
                embeds: [welcomeEmbed],
              });

              await welcomeMessage.react('❤️').catch(() => {});
              console.log(`✓ Mensagem de boas-vindas enviada com sucesso para ${user.tag}`);
            }
          } else {
            console.warn('WELCOME_CHANNEL_ID não configurado');
          }
        } catch (err) {
          console.error('Erro ao enviar mensagem de boas-vindas:', err);
          console.error('Stack:', err.stack);
        }

        await safeReply(interaction, {
          content: 'Recrutamento aprovado com sucesso.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (customId.startsWith('reject_recruit_modal:')) {
        const recruitId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasRecruitManagerRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para reprovar recrutamento.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const recruit = await getRecruitById(recruitId);
        if (!recruit) {
          return interaction.reply({
            content: 'Recrutamento não encontrado.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const motivo = interaction.fields.getTextInputValue('motivo_reprovacao');

        const updated = await updateRecruitStatus(recruitId, {
          status: 'rejected',
          rejectedBy: interaction.user.id,
          rejectReason: motivo,
        });

        // Atualiza mensagem de aprovação
        try {
          const approvalChannelId = recruit.approvalChannelId || updated?.approvalChannelId;
          const approvalMessageId = recruit.approvalMessageId || updated?.approvalMessageId;

          if (approvalChannelId && approvalMessageId) {
            const channel = await interaction.client.channels.fetch(approvalChannelId);
            if (channel && channel.isTextBased()) {
              const msg = await channel.messages.fetch(approvalMessageId).catch(() => null);
            if (msg) {
              const now = new Date();
              const originalEmbed = msg.embeds[0];
              const embed = EmbedBuilder.from(originalEmbed)
                .setColor(0xe74c3c)
                .addFields(
                  {
                    name: 'Status',
                    value: '❌ Reprovado',
                  },
                  {
                    name: 'Reprovado por',
                    value: `<@${interaction.user.id}> em ${formatDateBr(now)}`,
                  },
                  {
                    name: 'Motivo da reprovação',
                    value: motivo || 'Não informado.',
                  },
                )
                .setTimestamp(now);

              const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`approve_recruit:${recruitId}`)
                  .setLabel('Aprovado')
                  .setStyle(ButtonStyle.Success)
                  .setDisabled(true),
                new ButtonBuilder()
                  .setCustomId(`reject_recruit:${recruitId}`)
                  .setLabel('Reprovado')
                  .setStyle(ButtonStyle.Danger)
                  .setDisabled(true),
              );

              await msg.edit({ embeds: [embed], components: [disabledRow] });
            }
          }
          }
        } catch (err) {
          console.error('Erro ao atualizar mensagem de reprovação de recrutamento:', err);
        }

        await safeReply(interaction, {
          content: 'Recrutamento reprovado.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (err) {
    console.error('Erro em interactionCreate:', err);
    console.error('Stack trace:', err.stack);
    console.error('Interaction type:', interaction.type);
    console.error('Interaction customId:', interaction.customId || interaction.commandName);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({
        content: 'Ocorreu um erro ao processar a interação. Verifique os logs do bot.',
        flags: MessageFlags.Ephemeral,
      }).catch((replyErr) => {
        console.error('Erro ao enviar resposta de erro:', replyErr);
      });
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


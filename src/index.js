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
      {
        name: 'painel_recrutamento',
        description: 'Envia um bloco com botão para solicitar set no Duas Luas.',
        dm_permission: false,
      },
      {
        name: 'ranking_recrutamento',
        description: 'Mostra o ranking de recrutamento dos membros.',
        dm_permission: false,
      },
    ])
    .then(() => console.log('Slash commands registrados.'))
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
      } else if (interaction.commandName === 'painel_recrutamento') {
        const member = interaction.member;
        if (!memberHasRecruitManagerRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para enviar o painel de recrutamento.',
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setTitle('📋 Painel de Recrutamento - Duas Luas')
          .setDescription(
            'Clique no botão abaixo para **solicitar set** no Duas Luas.\n\n' +
              'Você deverá informar:\n' +
              '- Quem foi o seu **recrutador**;\n' +
              '- Seu **nome e sobrenome** in-game;\n' +
              '- Seu **telefone in-game** (não use número real);\n' +
              '- Seu **passaporte in-game** (veja no F11).',
          )
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
            ephemeral: true,
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
          ephemeral: true,
        });
      } else if (customId.startsWith('approve_recruit:')) {
        const recruitId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasRecruitManagerRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para aprovar recrutamento.',
            ephemeral: true,
          });
        }

        const recruit = await getRecruitById(recruitId);
        if (!recruit) {
          return interaction.reply({
            content: 'Recrutamento não encontrado.',
            ephemeral: true,
          });
        }

        if (recruit.status === 'approved') {
          return interaction.reply({
            content: 'Este recrutamento já foi aprovado.',
            ephemeral: true,
          });
        }
        if (recruit.status === 'rejected') {
          return interaction.reply({
            content: 'Este recrutamento já foi reprovado.',
            ephemeral: true,
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
            ephemeral: true,
          });
        }

        const recruit = await getRecruitById(recruitId);
        if (!recruit) {
          return interaction.reply({
            content: 'Recrutamento não encontrado.',
            ephemeral: true,
          });
        }

        if (recruit.status === 'approved') {
          return interaction.reply({
            content: 'Este recrutamento já foi aprovado.',
            ephemeral: true,
          });
        }
        if (recruit.status === 'rejected') {
          return interaction.reply({
            content: 'Este recrutamento já foi reprovado.',
            ephemeral: true,
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
      }
    }

    // Menus de seleção (recrutador)
    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === 'select_recruiter') {
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
      } else if (customId.startsWith('recruit_modal:')) {
        const recruiterId = customId.split(':')[1];
        const candidateId = interaction.user.id;

        const nomeCompleto = interaction.fields.getTextInputValue('nome_sobrenome');
        const telefone = interaction.fields.getTextInputValue('telefone_ingame');
        const passaporte = interaction.fields.getTextInputValue('passaporte_ingame');

        const approvalChannelId = process.env.RECRUIT_APPROVAL_CHANNEL_ID;
        if (!approvalChannelId) {
          return interaction.reply({
            content:
              'Canal de aprovações de recrutamento não configurado. Defina RECRUIT_APPROVAL_CHANNEL_ID no .env.',
            ephemeral: true,
          });
        }

        const guild = interaction.guild;
        const approvalChannel = await interaction.client.channels.fetch(approvalChannelId);
        if (!approvalChannel || !approvalChannel.isTextBased()) {
          return interaction.reply({
            content:
              'Canal de aprovações de recrutamento inválido. Verifique RECRUIT_APPROVAL_CHANNEL_ID.',
            ephemeral: true,
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
          ephemeral: true,
        });
      } else if (customId.startsWith('approve_recruit_modal:')) {
        const recruitId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasRecruitManagerRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para aprovar recrutamento.',
            ephemeral: true,
          });
        }

        const recruit = await getRecruitById(recruitId);
        if (!recruit) {
          return interaction.reply({
            content: 'Recrutamento não encontrado.',
            ephemeral: true,
          });
        }

        const primeiraCorrida = interaction.fields.getTextInputValue('primeira_corrida');
        const primeiroFarm = interaction.fields.getTextInputValue('primeiro_farm');
        const primeiroDesmanche = interaction.fields.getTextInputValue('primeiro_desmanche');

        const updated = await updateRecruitStatus(recruitId, {
          status: 'approved',
          approvedBy: interaction.user.id,
        });

        // Atualiza cargos do membro (remove olheiro, adiciona membro)
        try {
          const guild = interaction.guild;
          const guildMember = await guild.members.fetch(recruit.candidateId).catch(() => null);
          if (guildMember) {
            const olheiroRoleId = process.env.ROLE_OLHEIRO_ID;
            const membroRoleId = process.env.ROLE_MEMBRO_ID;

            if (olheiroRoleId && guildMember.roles.cache.has(olheiroRoleId)) {
              await guildMember.roles.remove(olheiroRoleId).catch(() => {});
            }
            if (membroRoleId) {
              await guildMember.roles.add(membroRoleId).catch(() => {});
            }
          }
        } catch (err) {
          console.error('Erro ao atualizar cargos do membro aprovado:', err);
        }

        // Atualiza mensagem de aprovação
        try {
          const channel = await interaction.client.channels.fetch(updated.approvalChannelId);
          if (channel && channel.isTextBased()) {
            const msg = await channel.messages.fetch(updated.approvalMessageId).catch(() => null);
            if (msg) {
              const now = new Date();
              const originalEmbed = msg.embeds[0];
              const embed = EmbedBuilder.from(originalEmbed)
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
                    value: primeiraCorrida,
                    inline: true,
                  },
                  {
                    name: 'Primeiro farm',
                    value: primeiroFarm,
                    inline: true,
                  },
                  {
                    name: 'Primeiro desmanche',
                    value: primeiroDesmanche,
                    inline: true,
                  },
                  {
                    name: 'Kit inicial',
                    value: '✅ Entregue o kit inicial para o membro.',
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
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true),
              );

              await msg.edit({ embeds: [embed], components: [disabledRow] });
            }
          }
        } catch (err) {
          console.error('Erro ao atualizar mensagem de aprovação de recrutamento:', err);
        }

        // Mensagem de boas-vindas
        try {
          const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
          if (welcomeChannelId) {
            const welcomeChannel = await interaction.client.channels.fetch(welcomeChannelId);
            if (welcomeChannel && welcomeChannel.isTextBased()) {
              const user = await interaction.client.users.fetch(recruit.candidateId);
              const avatarUrl = user.displayAvatarURL({ size: 256 });

              const welcomeEmbed = new EmbedBuilder()
                .setTitle('Bem vindo(a) ao Duas Luas!')
                .setDescription(`<@${recruit.candidateId}>, seja bem vindo(a) ao Duas Luas!`)
                .setThumbnail(avatarUrl)
                .setColor(0xe91e63);

              const welcomeMessage = await welcomeChannel.send({
                content: `<@${recruit.candidateId}> seja bem vindo(a) ao Duas Luas!`,
                embeds: [welcomeEmbed],
              });

              await welcomeMessage.react('❤️').catch(() => {});
            }
          }
        } catch (err) {
          console.error('Erro ao enviar mensagem de boas-vindas:', err);
        }

        await interaction.reply({
          content: 'Recrutamento aprovado com sucesso.',
          ephemeral: true,
        });
      } else if (customId.startsWith('reject_recruit_modal:')) {
        const recruitId = customId.split(':')[1];
        const member = interaction.member;

        if (!memberHasRecruitManagerRole(member)) {
          return interaction.reply({
            content: 'Você não tem permissão para reprovar recrutamento.',
            ephemeral: true,
          });
        }

        const recruit = await getRecruitById(recruitId);
        if (!recruit) {
          return interaction.reply({
            content: 'Recrutamento não encontrado.',
            ephemeral: true,
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
          const channel = await interaction.client.channels.fetch(updated.approvalChannelId);
          if (channel && channel.isTextBased()) {
            const msg = await channel.messages.fetch(updated.approvalMessageId).catch(() => null);
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
        } catch (err) {
          console.error('Erro ao atualizar mensagem de reprovação de recrutamento:', err);
        }

        await interaction.reply({
          content: 'Recrutamento reprovado.',
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


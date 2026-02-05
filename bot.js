import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { pool, testConnection } from './db.js';

// Testa a conexão com o banco antes de iniciar o bot
await testConnection();

async function connectToWhatsApp() {
    console.log("Iniciando o bot de notificações...");
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n\n----- QR Code para Conexão -----\n');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('\n\n----- CONEXÃO FECHADA -----\n');
            console.log('Motivo:', lastDisconnect?.error?.message);
            console.log('Tentando reconectar... ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('\n\n----- ✅ BOT CONECTADO E PRONTO! -----\n');
            verificarEEnviarNotificacoes(sock);
            iniciarVerificacaoPeriodica(sock);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

async function verificarEEnviarNotificacoes(sock) {
    console.log(`[${new Date().toLocaleString()}] Verificando agendamentos pendentes...`);
    try {
        // A mágica acontece aqui: query direta no banco!
        const [agendamentos] = await pool.execute(`
            SELECT 
                a.id,
                a.cliente_nome,
                a.data_horario,
                a.telefone
            FROM agendamentos a
            WHERE a.status = 'agendado'
            AND a.data_horario BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 26 HOUR)
            AND a.data_horario > DATE_ADD(NOW(), INTERVAL 1 HOUR)
            AND NOT EXISTS (
                SELECT 1 FROM whatsapp_notificacoes w
                WHERE w.agendamento_id = a.id
                AND w.enviado = 1
            )
            ORDER BY a.data_horario ASC
        `);

        if (agendamentos.length === 0) {
            console.log('-> Nenhum agendamento pendente de notificação.');
            return;
        }

        console.log(`-> Encontrados ${agendamentos.length} agendamentos para notificar.`);

        for (const agendamento of agendamentos) {
            await processarAgendamento(sock, agendamento);
        }

    } catch (error) {
        console.error('Erro ao buscar ou processar agendamentos pendentes:', error.message);
    }
}

async function processarAgendamento(sock, agendamento) {
    const { id, cliente_nome, data_horario, telefone } = agendamento;

    const numeroWhatsapp = `${telefone.replace(/\D/g, '')}@s.whatsapp.net`;
    
    const dataFormatada = new Date(data_horario).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const mensagem = `Olá, ${cliente_nome}! 😊\n\nPassando para lembrar do seu agendamento.\n\n🗓️ **Data e Hora:** ${dataFormatada}\n\nPor favor, confirme sua presença. Se precisar cancelar ou remarcar, nos avise com antecedência.\n\nAtenciosamente,\nSua Equipe`;

    try {
        await sock.sendMessage(numeroWhatsapp, { text: mensagem });
        console.log(`✅ Mensagem enviada para ${cliente_nome} (${numeroWhatsapp})`);

        // Confirma o envio inserindo no banco
        await pool.execute(
            "INSERT INTO whatsapp_notificacoes (agendamento_id, enviado, enviado_em) VALUES (?, 1, NOW()) ON DUPLICATE KEY UPDATE enviado = 1, enviado_em = NOW()",
            [id]
        );
        console.log(`   Notificação ID ${id} confirmada no banco.`);

    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem para ${cliente_nome}:`, error.message);
    }
}

function iniciarVerificacaoPeriodica(sock) {
    setInterval(() => {
        verificarEEnviarNotificacoes(sock);
    }, 5 * 60 * 1000); // 5 minutos
}

// Inicia o processo de conexão
connectToWhatsApp();
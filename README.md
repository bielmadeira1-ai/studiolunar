# LUNAR Studio ✦

Site estático e responsivo da Isla para o LUNAR Studio. Identidade azul/off-white/prata, elementos de apoio com rotação contínua e parallax no scroll, apresentação curta, dois serviços e fluxo de solicitação de horário via WhatsApp.

## Como visualizar

Abra `index.html` num navegador ou publique estes arquivos como site estático no Vercel, Netlify ou GitHub Pages. Não é necessário compilar.

## Configurar o WhatsApp

Em `script.js`, altere `whatsappNumber: ''` para o número da Isla no formato `5553999999999` (número ilustrativo; utilize o número real). Sem esse valor, o botão oferece a cópia da mensagem, mas não a envia a outra pessoa.

## Agenda e reservas

A agenda atualmente exibe **horários para solicitar**, não disponibilidade verificada. A pessoa escolhe data, um dos horários (14:00, 16:00, 18:00), o procedimento e envia um pedido pelo WhatsApp. **Isso não cria nem bloqueia uma reserva automaticamente.** A Isla precisa confirmar por mensagem.

Para impedir reservas duplicadas e ocultar horários efetivamente ocupados, integre um backend (ex.: Supabase) com registros de agendamentos, controle de disponibilidade, confirmação pela Isla e operação atômica para cada data/horário. Não armazene dados privados em um repositório público ou em código cliente.

## Imagens

As duas fotos fornecidas foram utilizadas como **referências ilustrativas** e devem ser substituídas por fotos dos trabalhos reais da Isla quando houver material, com autorização de uso das imagens de terceiros.

## Arquivos

- `index.html`: conteúdo e layout semântico.
- `styles.css`: design responsivo, animações, acessibilidade.
- `script.js`: calendário, escolha do serviço e pedido no WhatsApp.
- `assets/logo.webp`: logotipo recortado da identidade enviada.
- `assets/molde-f1.webp`: foto de referência do alongamento F1.
- `assets/esmalte-gel.webp`: foto de referência da esmaltação em gel.
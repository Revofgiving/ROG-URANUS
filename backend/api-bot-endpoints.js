/**
 * 🤖 BOT AI API ENDPOINTS
 * 
 * Endpoints da aggiungere a server.js o api-server.js
 * per integrazione bot AI con frontend
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 */

const botAIManager = require('./bot-ai-manager');

/**
 * Registra tutti gli endpoint bot AI nell'app Express
 * 
 * @param {Express.Application} app - App Express
 */
function registerBotAIEndpoints(app) {

  // ========================================
  // USER ENDPOINTS (Frontend)
  // ========================================

  /**
   * POST /api/bot/message
   * Invia messaggio al bot e ricevi risposta
   * 
   * Body: {
   *   walletAddress: string,
   *   message: string
   * }
   */
  app.post('/api/bot/message', async (req, res) => {
    try {
      const { walletAddress, message } = req.body;

      if (!walletAddress || !message) {
        return res.status(400).json({
          success: false,
          error: 'walletAddress e message richiesti'
        });
      }

      const response = await botAIManager.processMessage(walletAddress, message);

      return res.json({
        success: true,
        response
      });

    } catch (error) {
      console.error('Errore bot message:', error);
      return res.status(500).json({
        success: false,
        error: 'Errore elaborazione messaggio'
      });
    }
  });

  /**
   * GET /api/bot/conversation/:wallet
   * Ottiene storico conversazione utente
   */
  app.get('/api/bot/conversation/:wallet', async (req, res) => {
    try {
      const { wallet } = req.params;

      const conversation = await botAIManager.getConversation(wallet);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversazione non trovata'
        });
      }

      return res.json({
        success: true,
        conversation
      });

    } catch (error) {
      console.error('Errore get conversation:', error);
      return res.status(500).json({
        success: false,
        error: 'Errore recupero conversazione'
      });
    }
  });

  /**
   * GET /api/bot/stats
   * Statistiche bot (pubbliche)
   */
  app.get('/api/bot/stats', async (req, res) => {
    try {
      const stats = await botAIManager.getStatistics();

      return res.json({
        success: true,
        stats
      });

    } catch (error) {
      console.error('Errore bot stats:', error);
      return res.status(500).json({
        success: false,
        error: 'Errore statistiche bot'
      });
    }
  });

  // ========================================
  // ADMIN ENDPOINTS (Staff Dashboard)
  // ========================================

  /**
   * GET /api/admin/bot/faq
   * Lista tutte le FAQ (admin only)
   */
  app.get('/api/admin/bot/faq', async (req, res) => {
    try {
      // TODO: Add authentication middleware
      // const session = await authManager.validateSession(req.headers.authorization);
      // if (!session || !session.permissions.includes('READ_FAQ')) {
      //   return res.status(403).json({ success: false, error: 'Unauthorized' });
      // }

      const faq = await botAIManager.getAllFAQ();

      return res.json({
        success: true,
        faq
      });

    } catch (error) {
      console.error('Errore get FAQ:', error);
      return res.status(500).json({
        success: false,
        error: 'Errore recupero FAQ'
      });
    }
  });

  /**
   * POST /api/admin/bot/faq
   * Aggiungi nuova FAQ (admin only)
   * 
   * Body: {
   *   category: string,
   *   question: string,
   *   keywords: string[],
   *   answer: string
   * }
   */
  app.post('/api/admin/bot/faq', async (req, res) => {
    try {
      // TODO: Add authentication middleware

      const { category, question, keywords, answer } = req.body;

      if (!category || !question || !keywords || !answer) {
        return res.status(400).json({
          success: false,
          error: 'Tutti i campi sono richiesti'
        });
      }

      const newFAQ = await botAIManager.addFAQ({
        category,
        question,
        keywords: Array.isArray(keywords) ? keywords : [keywords],
        answer
      });

      return res.json({
        success: true,
        faq: newFAQ
      });

    } catch (error) {
      console.error('Errore add FAQ:', error);
      return res.status(500).json({
        success: false,
        error: 'Errore aggiunta FAQ'
      });
    }
  });

  /**
   * PUT /api/admin/bot/faq/:faqId
   * Modifica FAQ esistente (admin only)
   */
  app.put('/api/admin/bot/faq/:faqId', async (req, res) => {
    try {
      // TODO: Add authentication middleware

      const { faqId } = req.params;
      const updates = req.body;

      const updatedFAQ = await botAIManager.updateFAQ(faqId, updates);

      return res.json({
        success: true,
        faq: updatedFAQ
      });

    } catch (error) {
      console.error('Errore update FAQ:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Errore aggiornamento FAQ'
      });
    }
  });

  /**
   * DELETE /api/admin/bot/faq/:faqId
   * Elimina FAQ (admin only)
   */
  app.delete('/api/admin/bot/faq/:faqId', async (req, res) => {
    try {
      // TODO: Add authentication middleware

      const { faqId } = req.params;

      const deleted = await botAIManager.deleteFAQ(faqId);

      return res.json({
        success: true,
        deleted
      });

    } catch (error) {
      console.error('Errore delete FAQ:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Errore eliminazione FAQ'
      });
    }
  });

  console.log('✅ Bot AI endpoints registered');
}

module.exports = { registerBotAIEndpoints };

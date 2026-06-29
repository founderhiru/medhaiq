const express = require('express');
const router = express.Router();
const { generateNextQuestion, scoreAnswer, generateReport } = require('../services/interview');

// Route for starting a session
router.post('/start', async (req, res) => {
  try {
    const question = await generateNextQuestion(req.body);
    res.status(200).json({ success: true, question });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start session' });
  }
});

module.exports = router;
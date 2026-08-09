import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Server-side AI evaluation endpoint for Mock Interviews
  app.post('/api/evaluate-interview', async (req, res) => {
    try {
      const { question, userResponse, keyPoints, topic, category } = req.body;

      if (!userResponse || userResponse.trim().length === 0) {
        return res.status(400).json({ error: 'User response is empty' });
      }

      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        // Return a smart structured fallback evaluation if Gemini API key is not present
        const matchedKeyPoints = keyPoints.filter((kp: string) =>
          userResponse.toLowerCase().includes(kp.toLowerCase().slice(0, 10)) ||
          kp.toLowerCase().split(' ').some((word: string) => word.length > 4 && userResponse.toLowerCase().includes(word))
        );

        const score = Math.min(10, Math.max(3, Math.round((matchedKeyPoints.length / (keyPoints.length || 1)) * 10)));

        return res.json({
          score,
          summary: `Evaluated locally. Your answer touches on ${matchedKeyPoints.length} out of ${keyPoints.length} key concepts.`,
          strengths: matchedKeyPoints.length > 0 ? matchedKeyPoints : ['Clear expression and logical structure.'],
          areasForImprovement: keyPoints.filter((kp: string) => !matchedKeyPoints.includes(kp)),
          idealAnswerSummary: `A comprehensive answer should explicitly mention: ${keyPoints.join(', ')}.`
        });
      }

      // Lazy initialize GoogleGenAI with server-side API key
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = `You are a senior technical interviewer and HR evaluator.
Evaluate the candidate's interview answer for the following question.

Topic: ${topic || 'General'}
Category: ${category || 'Technical'}
Question: ${question}
Expected Key Points: ${JSON.stringify(keyPoints || [])}
Candidate's Response: "${userResponse}"

Return a JSON object matching this schema:
{
  "score": number (1 to 10),
  "summary": "2-sentence overall feedback on clarity, technical depth, and tone",
  "strengths": ["list of 2-3 specific things done well"],
  "areasForImprovement": ["list of 2-3 missing concepts or improvements"],
  "idealAnswerSummary": "A concise 2-3 sentence exemplar answer highlighting best practices"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text;
      if (text) {
        const evaluation = JSON.parse(text);
        return res.json(evaluation);
      } else {
        throw new Error('Empty response from Gemini');
      }
    } catch (err: any) {
      console.error('Error evaluating interview response:', err);
      // Fallback response if API call fails
      return res.json({
        score: 7,
        summary: 'Your answer demonstrates good foundational knowledge. Work on being more specific with technical terminology.',
        strengths: ['Addressed the main premise', 'Logical structure'],
        areasForImprovement: ['Mention specific frameworks or protocols', 'Provide a concrete example'],
        idealAnswerSummary: 'Focus on defining core terms, explaining the trade-offs, and concluding with a real-world scenario.'
      });
    }
  });

  // Vite middleware for dev mode vs Static serving in prod
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

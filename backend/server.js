import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { applySchema } from './src/db.js';
import authRoutes from './src/routes/auth.js';
import meRoutes from './src/routes/me.js';
import movieRoutes from './src/routes/movies.js';
import swipeRoutes from './src/routes/swipes.js';
import friendRoutes from './src/routes/friends.js';
import adminRoutes from './src/routes/admin.js';

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/swipes', swipeRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/admin', adminRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;

applySchema()
  .then(() => app.listen(port, () => console.log(`Backend listening on :${port}`)))
  .catch((err) => {
    console.error('Failed to apply schema', err);
    process.exit(1);
  });

import { MongoClient } from 'mongodb';

// Builds an independent, ever-growing archive of every movie ever shown to a
// user (separate from the Postgres `movies` table, which is just a cache
// keyed for joins). The point of this collection is to accumulate our own
// movie dataset over time so the app could switch away from TMDB later if
// needed. Never let archiving failures break the actual movie-browsing path.

let clientPromise = null;

function getClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export async function archiveMovies(movies) {
  const client = getClient();
  if (!client || !movies.length) return;

  try {
    const db = (await client).db();
    const collection = db.collection('movies');
    const now = new Date();

    await collection.bulkWrite(
      movies.map((m) => ({
        updateOne: {
          filter: { _id: m.id },
          update: {
            $set: {
              title: m.title,
              desc: m.desc,
              rating: m.rating,
              genres: m.genres,
              posterUrl: m.posterUrl,
              updatedAt: now,
            },
            $setOnInsert: { _id: m.id, firstSeenAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch (err) {
    console.error('Mongo movie archive write failed (non-fatal):', err.message);
  }
}

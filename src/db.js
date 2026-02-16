const mongoose = require('mongoose');
const Student = require('./models/Student');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    await Student.updateMany(
      {
        $or: [
          { subscriptionTier: { $exists: false } },
          { subscriptionTier: null }
        ]
      },
      {
        $set: {
          subscriptionTier: 'free'
        }
      }
    );

    await Student.updateMany(
      {
        currentSubscriptionId: { $exists: false }
      },
      {
        $set: {
          currentSubscriptionId: null
        }
      }
    );

    console.log('MongoDB connected');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

module.exports = connectDB;

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import dns from 'dns';

// Fix Node.js DNS SRV resolution on Windows for mongodb+srv://
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (dnsErr) {
  // Best effort
}

// Load .env explicitly
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { seedDemoData } from '../services/seed';
import User from '../models/User';
import Transaction from '../models/Transaction';
import LoanModel from '../models/Loan';
import MultiSigActionModel from '../models/MultiSigAction';
import FraudAlert from '../models/FraudAlert';
import DSBT from '../models/DSBT';
import X402Payment from '../models/X402Payment';
import WhatsAppSession from '../models/WhatsAppSession';
import AgentStateModel from '../models/AgentState';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not set in backend/.env');
    process.exit(1);
  }

  console.log(`📡 Connecting to MongoDB Atlas at: ${uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Connected successfully to MongoDB Atlas!\n');

    console.log('🌱 Seeding demo data...');
    const result = await seedDemoData(true);

    console.log('\n──────────────────────────────────────────────────────────────');
    console.log('🎉 DEMO DATA SEEDED TO MONGODB ATLAS SUCCESSFULLY!');
    console.log('──────────────────────────────────────────────────────────────');
    console.log(` Members:             ${result.members}`);
    console.log(` Staff Users:         ${result.staff}`);
    console.log(` Transactions:        ${result.transactions}`);
    console.log(` Loans:               ${result.loans}`);
    console.log(` Passports (d-SBT):   ${result.passports}`);
    console.log(` Pending Approvals:   ${result.pendingApprovals}`);

    // Read collection counts directly from database
    const userCount = await User.countDocuments();
    const txCount = await Transaction.countDocuments();
    const loanCount = await LoanModel.countDocuments();
    const multiSigCount = await MultiSigActionModel.countDocuments();
    const alertCount = await FraudAlert.countDocuments();
    const dsbtCount = await DSBT.countDocuments();
    const x402Count = await X402Payment.countDocuments();
    const agentState = await AgentStateModel.findOne();

    console.log('\n📊 DATABASE STATS ON MONGODB ATLAS:');
    console.log(`   Database Name:     ${mongoose.connection.db?.databaseName}`);
    console.log(`   Users Collection:  ${userCount} records`);
    console.log(`   Transactions:      ${txCount} records`);
    console.log(`   Loans:             ${loanCount} records`);
    console.log(`   MultiSig Actions:  ${multiSigCount} records`);
    console.log(`   Fraud Alerts:      ${alertCount} records`);
    console.log(`   d-SBT Passports:   ${dsbtCount} records`);
    console.log(`   x402 Payments:     ${x402Count} records`);
    console.log(`   Agent State:       ${agentState ? 'Initialized' : 'None'}`);

    console.log('\n🔑 DEMO CREDENTIALS:');
    console.log(`   Member:            ${result.credentials.member}`);
    console.log(`   Leader:            ${result.credentials.leader}`);
    console.log(`   Bank Manager:      ${result.credentials.bank}`);
    console.log(`   WhatsApp MPIN:     ${result.credentials.whatsappMpin}`);
    console.log('──────────────────────────────────────────────────────────────\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Failed to seed MongoDB Atlas:', error.message || error);
    process.exit(1);
  }
}

main();

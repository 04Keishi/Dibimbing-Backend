const { Command } = require('commander');
const inquirer = require('inquirer');
const prompt = inquirer.createPromptModule();
const mysql = require('mysql2/promise');
const fs = require('fs');

const program = new Command();
let currentUser = null;

const dbConfig = { 
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'simulasi_atm'
};

// Registrasi Pengguna baru
program
    .command('register')
    .description('Mendaftarkan pengguna baru')
    .action(async () => {
        const conn = await mysql.createConnection(dbConfig);
        const { name, pin } = await prompt([
            { type: 'input', name: 'name', message: 'Masukkan nama lengkap anda:' },
            { type: 'password', name: 'pin', message: 'Masukkan PIN anda:' }
        ]);
        const [result] = await conn.execute('INSERT INTO accounts (name, pin) VALUES (?, ?)', [name, pin]);
        console.log(`Akun berhasil dibuat dengan ID: ${result.insertId} (Harap diingat untuk keperluan login anda), silahkan login menggunakan id dan PIN yang telah didaftarkan.`);
        await conn.end();
    });

// Login pengguna
program 
    .command('login')
    .description('Masuk ke akun ATM')
    .action(async () => {
        const conn = await mysql.createConnection(dbConfig);
        const { id, pin } = await prompt([
            { type: 'input', name: 'id', message: 'Masukkan id akun anda:' },
            { type: 'password', name: 'pin', message: 'Masukkan PIN anda:' }
        ]);
        const [rows] = await conn.execute('SELECT * FROM accounts WHERE id = ? AND pin = ?', [id, pin]);
        if (rows.length > 0) {
            currentUser = rows[0];
            fs.writeFileSync('session.json', JSON.stringify(currentUser));
            console.log(`Selamat datang, ${currentUser.name}!`);
        } else {
            console.log('Nama atau PIN salah. Silahkan coba lagi.');
        }
        await conn.end();
    });

// chekc-balance untuk menampilkan saldo pengguna
program
    .command('check-balance')
    .description('cek saldo akun anda')
    .action(async () => {
         let currentUser;
    try {
      currentUser = JSON.parse(fs.readFileSync('session.json', 'utf-8'));
    } catch {
      return console.log('Anda harus login terlebih dahulu.');
    }
        const conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute('SELECT balance FROM accounts WHERE id = ?', [currentUser.id]);
        console.log(`Saldo anda saat ini adalah: Rp ${rows[0].balance}`);
        await conn.end();
    });

// tarik tunai
program
    .command('withdraw')
    .description('Tarik tunai dari akun anda')
    .action(async () => {
         let currentUser;
    try {
      currentUser = JSON.parse(fs.readFileSync('session.json', 'utf-8'));
    } catch {
      return console.log('Anda harus login terlebih dahulu.');
    }
        const conn = await mysql.createConnection(dbConfig);
        const { amount } = await prompt([
            { type: 'input', name: 'amount', message: 'Masukkan jumlah uang yang ingin ditarik:' }
        ]);
        const [rows] = await conn.execute('SELECT balance FROM accounts WHERE id = ?', [currentUser.id]);
        const currentBalance = parseFloat(rows[0].balance);
        const tarik = parseFloat(amount);
    
        if (currentBalance >= tarik) {
            await conn.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [tarik, currentUser.id]);
            console.log(`Berhasil menarik Rp ${tarik}. Saldo anda sekarang adalah Rp ${currentBalance - tarik}`);
            await conn.execute('INSERT INTO transactions (account_id, type, amount) VALUES (?, ?, ?)', [currentUser.id, 'withdraw', tarik]);
        } else {
            console.log('Saldo tidak cukup untuk melakukan penarikan.');
        }

        await conn.end();
    })

// Deposit uang
program 
    .command('deposit')
    .description('Deposit uang ke akun anda')
    .action(async () => {
         let currentUser;
    try {
      currentUser = JSON.parse(fs.readFileSync('session.json', 'utf-8'));
    } catch {
      return console.log('Anda harus login terlebih dahulu.');
    }
        const conn = await mysql.createConnection(dbConfig);
        const { amount } = await prompt([
            { type: 'input', name: 'amount', message: 'Masukkan jumlah uang yang ingin didepositkan:' }
        ]);
        await conn.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', [amount, currentUser.id]);
        await conn.execute('INSERT INTO transactions (account_id, type, amount) VALUES (?, ?, ?)', [currentUser.id, 'deposit', amount]);
        const [rows] = await conn.execute('SELECT balance FROM accounts WHERE id = ?', [currentUser.id]);
        console.log(`Berhasil mendeposit Rp ${amount}. Saldo anda sekarang adalah Rp ${rows[0].balance}`);
        await conn.end();
    });

// Transfer uang in dan out
program
  .command('transfer')
  .description('Transfer saldo ke akun lain')
  .action(async () => {
    let currentUser;
    try {
      currentUser = JSON.parse(fs.readFileSync('session.json', 'utf-8'));
    } catch {
      return console.log('Anda harus login terlebih dahulu.');
    }
    const { targetId, amount } = await prompt([
      { type: 'input', name: 'targetId', message: 'Nomor akun tujuan:' },
      { type: 'input', name: 'amount', message: 'Jumlah transfer:' }
    ]);
    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute('SELECT balance FROM accounts WHERE id = ?', [currentUser.id]);
    if (parseFloat(rows[0].balance) < parseFloat(amount)) {
      console.log('Saldo anda tidak mencukupi.');
      return await conn.end();
    }

    const [targetRows] = await conn.execute('SELECT * FROM accounts WHERE id = ?', [targetId]);
    if (targetRows.length === 0) {
      console.log('Akun tujuan tidak ditemukan.');
      return await conn.end();
    }
    await conn.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [amount, currentUser.id]);
    await conn.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', [amount, targetId]);

    await conn.execute(
      'INSERT INTO transactions (account_id, type, amount, target_id) VALUES (?, ?, ?, ?)',
      [currentUser.id, 'transfer_out', amount, targetId]
    );
    await conn.execute(
      'INSERT INTO transactions (account_id, type, amount, target_id) VALUES (?, ?, ?, ?)',
      [targetId, 'transfer_in', amount, currentUser.id]
    );

    const [updated] = await conn.execute('SELECT balance FROM accounts WHERE id = ?', [currentUser.id]);

    console.log(`Transfer berhasil! Saldo anda sekarang adalah: Rp ${updated[0].balance}`);
    await conn.end();
  });

// menampilkan riwayat transaksi
program
    .command('history')
    .description('Menampilkan riwayat transaksi')
    .action(async () => {
         let currentUser;
    try {
      currentUser = JSON.parse(fs.readFileSync('session.json', 'utf-8'));
    } catch {
      return console.log('Anda harus login terlebih dahulu.');
    }
        const conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute('SELECT * FROM transactions WHERE account_id = ?', [currentUser.id]);
        if (rows.length === 0) {
            console.log('Tidak ada riwayat transaksi.');
        } else {
            console.table(rows);
        }
        await conn.end();
    });

// Logout
program
  .command('logout')
  .description('Keluar dari sesi login')
  .action(async () => {
    const fs = require('fs');
    const inquirer = require('inquirer');
    const prompt = inquirer.createPromptModule();

    if (!fs.existsSync('session.json')) {
      console.log('Anda belum login.');
      return;
    }

    const { confirm } = await prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Apakah anda ingin melakukan transaksi lagi?',
        default: false
      }
    ]);

    if (!confirm) {
      fs.unlinkSync('session.json');
      console.log('Logout berhasil.');
    } else {
      return;
    }
  });

program.parse(process.argv);
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createCRX(extensionDir, privateKeyPath, outputPath) {
  // Read private key
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

  // Create ZIP of extension directory
  const { execSync } = require('child_process');
  const tempZip = path.join(__dirname, 'temp-extension.zip');

  try {
    // Create ZIP using PowerShell
    execSync(`powershell -Command "Compress-Archive -Path '${extensionDir}\\*' -DestinationPath '${tempZip}' -Force"`, {
      stdio: 'inherit'
    });

    const zipBuffer = fs.readFileSync(tempZip);

    // Generate signature
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(zipBuffer);
    const signature = sign.sign(privateKey);

    // Extract public key
    const keyData = crypto.createPublicKey(privateKey);
    const publicKeyDER = keyData.export({ type: 'spki', format: 'der' });

    // CRX3 format with signed header data
    const signedHeaderData = Buffer.alloc(12);
    signedHeaderData.writeUInt32LE(publicKeyDER.length, 0);
    signedHeaderData.writeUInt32LE(signature.length, 4);
    signedHeaderData.writeUInt32LE(0, 8); // No additional signed data

    const crxHeader = Buffer.alloc(12);
    crxHeader.write('Cr24', 0, 'ascii'); // Magic number
    crxHeader.writeUInt32LE(3, 4); // CRX3 version
    crxHeader.writeUInt32LE(signedHeaderData.length + publicKeyDER.length + signature.length, 8);

    // Combine all parts
    const crx = Buffer.concat([
      crxHeader,
      signedHeaderData,
      publicKeyDER,
      signature,
      zipBuffer
    ]);

    fs.writeFileSync(outputPath, crx);
    fs.unlinkSync(tempZip);

    console.log(`CRX created successfully: ${outputPath}`);
    console.log(`Size: ${(crx.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    if (fs.existsSync(tempZip)) {
      fs.unlinkSync(tempZip);
    }
    throw error;
  }
}

// Run
const extensionDir = path.join(__dirname, 'dist');
const privateKeyPath = path.join(__dirname, 'crx_private.pem');
const outputPath = path.join(__dirname, 'discord-server-leaver-v2.1.0.crx');

createCRX(extensionDir, privateKeyPath, outputPath);

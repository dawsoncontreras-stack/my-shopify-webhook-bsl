// api/webhooks/shopify.js
// UPDATED VERSION - Separates wallets from accessories and tracks wallet attributes

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Verify webhook is from Shopify
 */
function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  
  return hash === hmacHeader;
}

/**
 * Get raw body from request
 */
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', reject);
  });
}

/**
 * Main webhook handler for Vercel
 */
async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = await getRawBody(req);
    const body = JSON.parse(rawBody);
    
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    const shopifyTopic = req.headers['x-shopify-topic'];

    console.log('✅ Webhook received:', shopifyTopic);

    // TEMPORARY: Skip HMAC verification for development
    // const isValid = verifyShopifyWebhook(rawBody, hmacHeader, process.env.SHOPIFY_WEBHOOK_SECRET);
    const isValid = true;

    if (!isValid) {
      console.error('❌ Invalid webhook signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Route to appropriate handler
    switch (shopifyTopic) {
      case 'orders/create':
        await handleOrderCreate(body);
        break;
      
      case 'orders/updated':
        await handleOrderUpdate(body);
        break;

      default:
        console.log(`Unhandled topic: ${shopifyTopic}`);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(200).json({ error: error.message });
  }
}

// Vercel config - must be a named export
export const config = {
  api: {
    bodyParser: false,
  },
};

// Default export
export default handler;

/**
 * Extract wallet attributes from line item properties
 * Returns structured data for wallet customization
 */
function extractWalletAttributes(lineItem) {
  const attributes = {
    color: null,
    leather_type: null,
    thread_color: null,
    has_monogram: false,
    monogram_text: null,
    monogram_font: null,
    has_special_engraving: false,
    special_engraving_text: null,
    engraving_font: null,
    engraving_location: null,
    has_custom_id: false,
    custom_id_text: null,
    has_custom_logo: false,
    custom_logo_details: null,
    has_badge_cutout: false,
    badge_type: null,
    customer_note: null,
    other_customizations: []
  };

  if (!lineItem.properties || !Array.isArray(lineItem.properties)) {
    return attributes;
  }

  lineItem.properties.forEach(prop => {
    const key = prop.name.toLowerCase();
    const value = prop.value;

    // Map properties to attributes
    if (key.includes('color') || key.includes('leather')) {
      if (key.includes('thread')) {
        attributes.thread_color = value;
      } else {
        attributes.color = value;
        attributes.leather_type = value;
      }
    } 
    else if (key.includes('monogram')) {
      attributes.has_monogram = true;
      if (key.includes('font')) {
        attributes.monogram_font = value;
      } else {
        attributes.monogram_text = value;
      }
    } 
    else if (key.includes('special engraving')) {
      attributes.has_special_engraving = true;
      attributes.special_engraving_text = value;
    }
    else if (key.includes('engraving_font')) {
      attributes.engraving_font = value;
    }
    else if (key.includes('engraving_location')) {
      attributes.engraving_location = value;
    }
    else if (key.includes('custom id') || key.includes('add custom id')) {
      attributes.has_custom_id = true;
      attributes.custom_id_text = value;
    } 
    else if (key.includes('badge type')) {
      attributes.badge_type = value;
    }
    else if (key.includes('badge cutout') || key.includes('add custom badge cutout')) {
      attributes.has_badge_cutout = true;
      if (value && value !== 'Yes') {
        attributes.badge_type = value;
      }
    } 
    else if (key.includes('custom_logo') || key.includes('custom logo')) {
      attributes.has_custom_logo = true;
      attributes.custom_logo_details = value;
    }
    else if (key.includes('customer_note') || key.includes('customer note')) {
      attributes.customer_note = value;
    }
    else {
      // Store other customizations
      attributes.other_customizations.push({
        name: prop.name,
        value: value
      });
    }
  });

  return attributes;
}

/**
 * Determine if a line item is a wallet product
 * Returns the wallet type if it's a wallet, null otherwise
 */
function getWalletType(productName) {
  if (!productName) return null;
  
  const name = productName.toLowerCase();
  
  // Import from walletMapping or define inline
  const WALLET_KEYWORDS = [
    'peyton', 'richmond', 'keller', 'georgetown', 'pflugerville',
    'badge', 'western', 'passport', 'victory', 'tyler', 'mansfield',
    'federal', 'houstonian', 'sugar land', 'trinity', 'rio grande',
    'big bend', 'glory', 'bifold', 'trifold', 'clutch', 'long wallet',
    'vertical wallet', 'money clip', 'minimalist'
  ];
  
  // Check if product name contains wallet keywords
  const isWallet = WALLET_KEYWORDS.some(keyword => name.includes(keyword));
  
  if (!isWallet) {
    return null;
  }
  
  // Return the product name as the wallet type (will be normalized later)
  return productName;
}

/**
 * Determine if a line item is an accessory/add-on
 */
function isAccessoryItem(productName) {
  if (!productName) return false;
  
  const name = productName.toLowerCase();
  const ACCESSORY_KEYWORDS = [
    'monogram',
    'special engraving',
    'monogram_font',
    'engraving_font',
    'engraving_location',
    'customer_note',
    'custom_logo',
    'add custom id',
    'badge type',
    'add custom badge cutout',
    'rfid cards',
    'extra'
  ];
  
  return ACCESSORY_KEYWORDS.some(keyword => name.includes(keyword));
}

/**
 * Handle new order creation
 */
async function handleOrderCreate(shopifyOrder) {
  console.log('📦 Processing new order:', shopifyOrder.order_number);

  const customerName = shopifyOrder.customer 
    ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim()
    : shopifyOrder.billing_address?.name || 'Unknown';

  const customerEmail = shopifyOrder.customer?.email || 
                       shopifyOrder.contact_email || 
                       null;

  const orderTags = shopifyOrder.tags ? shopifyOrder.tags.split(',').map(t => t.trim()) : [];

  // Separate wallets from accessories
  const walletItems = [];
  const accessoryItems = [];
  
  shopifyOrder.line_items.forEach(item => {
    const walletType = getWalletType(item.title);
    if (walletType) {
      walletItems.push({ ...item, detected_wallet_type: walletType });
    } else if (isAccessoryItem(item.title)) {
      accessoryItems.push(item);
    } else {
      // Unknown items - treat as accessories for now
      accessoryItems.push(item);
    }
  });

  // Calculate total points (will be updated later by wallet mapping)
  let totalPoints = 0;
  
  // Collate wallet types
  const walletTypes = walletItems
    .map(item => item.detected_wallet_type)
    .filter(Boolean)
    .join(', ');

  // Create parent order
  const orderData = {
    order_number: shopifyOrder.order_number.toString(),
    shopify_order_id: shopifyOrder.id.toString(),
    status: 'pending',
    orderer_name: customerName,
    points: totalPoints, // Will be updated after wallet mapping
    wallet_type: walletTypes || null, // Collated wallet types
    total_wallets: walletItems.length,
    total_accessories: accessoryItems.length,
    
    shopify_metadata: {
      shopify_order_id: shopifyOrder.id,
      order_number: shopifyOrder.order_number,
      customer_email: customerEmail,
      customer_name: customerName,
      tags: orderTags,
      financial_status: shopifyOrder.financial_status,
      fulfillment_status: shopifyOrder.fulfillment_status,
      note: shopifyOrder.note || null,
      note_attributes: shopifyOrder.note_attributes || [],
      total_price: shopifyOrder.total_price,
      currency: shopifyOrder.currency,
      created_at: shopifyOrder.created_at,
      shipping_address: shopifyOrder.shipping_address,
    }
  };

  const { data: insertedOrder, error: orderError } = await supabase
    .from('orders')
    .insert([orderData])
    .select()
    .single();

  if (orderError) {
    console.error('❌ Order insert error:', orderError);
    throw orderError;
  }

  console.log('✅ Order inserted:', insertedOrder.order_number);

  // Create line items for WALLETS
  const walletLineItemsData = walletItems.map(item => {
    const walletAttributes = extractWalletAttributes(item);
    
    return {
      order_id: insertedOrder.id,
      order_number: insertedOrder.order_number,
      item_type: 'wallet', // NEW: Distinguish from accessories
      
      product_id: item.product_id?.toString(),
      variant_id: item.variant_id?.toString(),
      sku: item.sku,
      product_name: item.title,
      variant_name: item.variant_title,
      quantity: item.quantity,
      price: parseFloat(item.price),
      
      wallet_type: null, // Will be assigned by wallet mapping function
      points: 0, // Will be assigned by wallet mapping function
      wallet_attributes: walletAttributes, // NEW: Structured wallet customization data
      
      status: 'pending',
      
      shopify_line_item: {
        product_id: item.product_id,
        variant_id: item.variant_id,
        sku: item.sku,
        title: item.title,
        variant_title: item.variant_title,
        quantity: item.quantity,
        price: item.price,
        properties: item.properties || [],
        vendor: item.vendor,
        product_type: item.product_type,
      }
    };
  });

  // Create line items for ACCESSORIES
  const accessoryLineItemsData = accessoryItems.map(item => {
    return {
      order_id: insertedOrder.id,
      order_number: insertedOrder.order_number,
      item_type: 'accessory', // NEW: Mark as accessory
      
      product_id: item.product_id?.toString(),
      variant_id: item.variant_id?.toString(),
      sku: item.sku,
      product_name: item.title,
      variant_name: item.variant_title,
      quantity: item.quantity,
      price: parseFloat(item.price),
      
      wallet_type: null, // Not applicable for accessories
      points: 0, // Accessories don't earn points
      wallet_attributes: null, // Not applicable for accessories
      
      status: 'pending',
      
      shopify_line_item: {
        product_id: item.product_id,
        variant_id: item.variant_id,
        sku: item.sku,
        title: item.title,
        variant_title: item.variant_title,
        quantity: item.quantity,
        price: item.price,
        properties: item.properties || [],
        vendor: item.vendor,
        product_type: item.product_type,
      }
    };
  });

  // Insert all line items (wallets + accessories)
  const allLineItems = [...walletLineItemsData, ...accessoryLineItemsData];
  
  if (allLineItems.length > 0) {
    const { data: insertedLineItems, error: lineItemsError } = await supabase
      .from('order_line_items')
      .insert(allLineItems)
      .select();

    if (lineItemsError) {
      console.error('❌ Line items insert error:', lineItemsError);
      throw lineItemsError;
    }

    console.log(`✅ Created ${walletLineItemsData.length} wallet items and ${accessoryLineItemsData.length} accessory items`);
    
    // Log wallet details
    insertedLineItems
      .filter(item => item.item_type === 'wallet')
      .forEach((item, idx) => {
        const attrs = item.wallet_attributes;
        const customizations = [];
        if (attrs?.has_monogram) customizations.push('Monogram');
        if (attrs?.has_custom_id) customizations.push('Custom ID');
        if (attrs?.has_badge_cutout) customizations.push('Badge Cutout');
        
        console.log(`   Wallet ${idx + 1}: ${item.product_name}${item.variant_name ? ' - ' + item.variant_name : ''}${customizations.length > 0 ? ' [' + customizations.join(', ') + ']' : ''}`);
      });
  }

  return { success: true, order: insertedOrder };
}

/**
 * Handle order updates
 */
async function handleOrderUpdate(shopifyOrder) {
  console.log('🔄 Processing order update:', shopifyOrder.order_number);

  // Find existing order
  const { data: existingOrder } = await supabase
    .from('orders')
    .select('*')
    .eq('shopify_order_id', shopifyOrder.id.toString())
    .single();

  if (!existingOrder) {
    console.log('Order not found, creating new order');
    return handleOrderCreate(shopifyOrder);
  }

  // Update order metadata
  const updateData = {
    shopify_metadata: {
      ...existingOrder.shopify_metadata,
      financial_status: shopifyOrder.financial_status,
      fulfillment_status: shopifyOrder.fulfillment_status,
      updated_at: new Date().toISOString(),
    }
  };

  const { error } = await supabase
    .from('orders')
    .update(updateData)
    .eq('id', existingOrder.id);

  if (error) {
    console.error('❌ Order update error:', error);
    throw error;
  }

  console.log('✅ Order updated:', shopifyOrder.order_number);
  return { success: true };
}
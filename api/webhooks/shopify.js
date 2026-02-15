// api/webhooks/shopify.js
// FIXED VERSION - Handles Vercel's automatic body parsing

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Verify webhook is from Shopify
 * NOTE: In Vercel, req.body is already parsed, so we need to re-stringify it
 */
function verifyShopifyWebhook(body, hmacHeader, secret) {
  // Convert the parsed body back to a string for verification
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  
  console.log('Computed hash:', hash);
  console.log('Shopify hash:', hmacHeader);
  console.log('Match:', hash === hmacHeader);
  
  return hash === hmacHeader;
}

/**
 * Vercel config to get raw body
 */
export const config = {
  api: {
    bodyParser: false, // Disable automatic body parsing
  },
};

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
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the raw body for HMAC verification
    const rawBody = await getRawBody(req);
    const body = JSON.parse(rawBody);
    
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    const shopifyTopic = req.headers['x-shopify-topic'];

    console.log('Secret from env:', process.env.SHOPIFY_WEBHOOK_SECRET ? 'EXISTS' : 'MISSING');
    console.log('HMAC header:', hmacHeader);
    console.log('Topic:', shopifyTopic);

    // Verify webhook authenticity
    const isValid = verifyShopifyWebhook(
      rawBody,
      hmacHeader,
      process.env.SHOPIFY_WEBHOOK_SECRET
    );

    if (!isValid) {
      console.error('❌ Invalid webhook signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`✅ Webhook received: ${shopifyTopic}`);

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

/**
 * Extract tags from Shopify line item properties
 */
function extractLineItemTags(lineItem) {
  const tags = [];
  
  if (lineItem.properties && Array.isArray(lineItem.properties)) {
    lineItem.properties.forEach(prop => {
      const key = prop.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const value = prop.value.toLowerCase().replace(/\s+/g, '_');
      tags.push(`${key}:${value}`);
    });
  }
  
  return tags;
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

  // Create parent order
  const orderData = {
    order_number: shopifyOrder.order_number.toString(),
    shopify_order_id: shopifyOrder.id.toString(),
    status: 'pending',
    orderer_name: customerName,
    points: 0,
    wallet_type: null,
    total_wallets: shopifyOrder.line_items.length,
    
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

  // Create line items
  const lineItemsData = shopifyOrder.line_items.map(item => {
    const itemTags = extractLineItemTags(item);
    
    return {
      order_id: insertedOrder.id,
      order_number: insertedOrder.order_number,
      
      product_id: item.product_id?.toString(),
      variant_id: item.variant_id?.toString(),
      sku: item.sku,
      product_name: item.title,
      variant_name: item.variant_title,
      quantity: item.quantity,
      price: parseFloat(item.price),
      
      wallet_type: null,
      points: 0,
      tags: itemTags,
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

  const { data: insertedLineItems, error: lineItemsError } = await supabase
    .from('order_line_items')
    .insert(lineItemsData)
    .select();

  if (lineItemsError) {
    console.error('❌ Line items insert error:', lineItemsError);
    throw lineItemsError;
  }

  console.log(`✅ Created ${insertedLineItems.length} line items`);
  insertedLineItems.forEach((item, idx) => {
    console.log(`   Wallet ${idx + 1}: ${item.product_name}${item.variant_name ? ' - ' + item.variant_name : ''}`);
    if (item.tags.length > 0) {
      console.log(`      Tags: ${item.tags.join(', ')}`);
    }
  });
  
  return insertedOrder;
}

/**
 * Handle order updates
 */
async function handleOrderUpdate(shopifyOrder) {
  console.log('🔄 Updating order:', shopifyOrder.order_number);

  const customerName = shopifyOrder.customer 
    ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim()
    : shopifyOrder.billing_address?.name || 'Unknown';

  const customerEmail = shopifyOrder.customer?.email || 
                       shopifyOrder.contact_email || 
                       null;

  const orderTags = shopifyOrder.tags ? shopifyOrder.tags.split(',').map(t => t.trim()) : [];

  const updateData = {
    orderer_name: customerName,
    updated_at: new Date().toISOString(),
    
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
      updated_at: shopifyOrder.updated_at,
      cancelled_at: shopifyOrder.cancelled_at,
      shipping_address: shopifyOrder.shipping_address,
    }
  };

  const { error: orderError } = await supabase
    .from('orders')
    .update(updateData)
    .eq('order_number', shopifyOrder.order_number.toString());

  if (orderError) {
    console.error('❌ Order update error:', orderError);
    throw orderError;
  }

  if (shopifyOrder.cancelled_at) {
    const { error: voidError } = await supabase
      .from('order_line_items')
      .update({
        status: 'void',
        voided_at: shopifyOrder.cancelled_at
      })
      .eq('order_number', shopifyOrder.order_number.toString())
      .eq('status', 'pending');

    if (voidError) {
      console.error('❌ Line items void error:', voidError);
    } else {
      console.log('✅ Voided pending line items');
    }
  }

  console.log('✅ Order updated:', shopifyOrder.order_number);
  console.log('   Financial:', shopifyOrder.financial_status);
  console.log('   Fulfillment:', shopifyOrder.fulfillment_status);
}
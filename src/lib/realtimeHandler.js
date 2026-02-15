// realtimeHandler.js
// Real-time subscriptions for processing line items and handling claims

import { createClient } from '@supabase/supabase-js';
import { processLineItem, processOrderLineItems } from './walletMapping.js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

/**
 * Subscribe to new line items and auto-assign wallet types
 */
export function subscribeToLineItems(onUpdate) {
  const channel = supabase
    .channel('line-items-processing')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'order_line_items'
      },
      async (payload) => {
        console.log('📦 New line item:', payload.new.product_name);
        
        // Auto-assign wallet type and points
        const processed = await processLineItem(supabase, payload.new);
        
        // Notify UI
        if (onUpdate) {
          onUpdate({
            type: 'new',
            lineItem: processed || payload.new
          });
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'order_line_items'
      },
      (payload) => {
        console.log('🔄 Line item updated:', payload.new.product_name);
        
        // Notify UI
        if (onUpdate) {
          onUpdate({
            type: 'update',
            lineItem: payload.new,
            oldLineItem: payload.old
          });
        }
      }
    )
    .subscribe();

  return channel;
}

/**
 * Subscribe to order updates to keep parent order in sync
 */
export function subscribeToOrders(onUpdate) {
  const channel = supabase
    .channel('orders-updates')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'orders'
      },
      async (payload) => {
        console.log('📦 New order:', payload.new.order_number);
        
        // Process all line items for this order
        await processOrderLineItems(supabase, payload.new.id);
        
        if (onUpdate) {
          onUpdate({
            type: 'new',
            order: payload.new
          });
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders'
      },
      (payload) => {
        if (onUpdate) {
          onUpdate({
            type: 'update',
            order: payload.new
          });
        }
      }
    )
    .subscribe();

  return channel;
}

/**
 * CLAIMING FUNCTIONS
 */

/**
 * Claim a single wallet (line item)
 */
export async function claimWallet(lineItemId, sewerId, sewerName) {
  const { data, error } = await supabase
    .from('order_line_items')
    .update({
      status: 'claimed',
      claimed_by: sewerId,
      claimed_by_name: sewerName,
      claimed_at: new Date().toISOString()
    })
    .eq('id', lineItemId)
    .eq('status', 'pending') // Only claim if pending
    .select()
    .single();

  if (error) {
    console.error('❌ Error claiming wallet:', error);
    return { success: false, error };
  }

  console.log('✅ Wallet claimed:', data.product_name);
  return { success: true, data };
}

/**
 * Claim ALL wallets in an order
 */
export async function claimEntireOrder(orderId, sewerId, sewerName) {
  const { data, error } = await supabase
    .from('order_line_items')
    .update({
      status: 'claimed',
      claimed_by: sewerId,
      claimed_by_name: sewerName,
      claimed_at: new Date().toISOString()
    })
    .eq('order_id', orderId)
    .eq('status', 'pending') // Only claim pending ones
    .select();

  if (error) {
    console.error('❌ Error claiming order:', error);
    return { success: false, error };
  }

  console.log(`✅ Claimed ${data.length} wallets from order`);
  return { success: true, data };
}

/**
 * Claim multiple specific wallets from an order
 */
export async function claimPartialOrder(lineItemIds, sewerId, sewerName) {
  const { data, error } = await supabase
    .from('order_line_items')
    .update({
      status: 'claimed',
      claimed_by: sewerId,
      claimed_by_name: sewerName,
      claimed_at: new Date().toISOString()
    })
    .in('id', lineItemIds)
    .eq('status', 'pending')
    .select();

  if (error) {
    console.error('❌ Error claiming wallets:', error);
    return { success: false, error };
  }

  console.log(`✅ Claimed ${data.length} wallets`);
  return { success: true, data };
}

/**
 * Mark a wallet as in progress
 */
export async function startWorkOnWallet(lineItemId) {
  const { data, error } = await supabase
    .from('order_line_items')
    .update({
      status: 'in_progress'
    })
    .eq('id', lineItemId)
    .eq('status', 'claimed')
    .select()
    .single();

  if (error) {
    console.error('❌ Error starting work:', error);
    return { success: false, error };
  }

  return { success: true, data };
}

/**
 * Complete a wallet
 */
export async function completeWallet(lineItemId) {
  const { data, error } = await supabase
    .from('order_line_items')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', lineItemId)
    .in('status', ['claimed', 'in_progress'])
    .select()
    .single();

  if (error) {
    console.error('❌ Error completing wallet:', error);
    return { success: false, error };
  }

  // Update daily points for the sewer
  if (data.claimed_by && data.points > 0) {
    await updateDailyPoints(data.claimed_by, data.claimed_by_name, data.points);
  }

  console.log('✅ Wallet completed:', data.product_name);
  return { success: true, data };
}

/**
 * Update daily points for a sewer
 */
async function updateDailyPoints(sewerId, sewerName, points) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Try to get existing record for today
  const { data: existing } = await supabase
    .from('daily_points')
    .select('*')
    .eq('sewer_id', sewerId)
    .eq('date', today)
    .single();

  if (existing) {
    // Update existing record
    await supabase
      .from('daily_points')
      .update({
        points: existing.points + points,
        orders_completed: existing.orders_completed + 1
      })
      .eq('id', existing.id);
  } else {
    // Create new record
    await supabase
      .from('daily_points')
      .insert({
        sewer_id: sewerId,
        sewer_name: sewerName,
        date: today,
        points: points,
        orders_completed: 1
      });
  }
}

/**
 * Get all available wallets (unclaimed)
 */
export async function getAvailableWallets() {
  const { data, error } = await supabase
    .from('order_line_items')
    .select(`
      *,
      orders!inner (
        order_number,
        shopify_metadata
      )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching available wallets:', error);
    return [];
  }

  return data;
}

/**
 * Get wallets for a specific order
 */
export async function getOrderWallets(orderId) {
  const { data, error } = await supabase
    .from('order_line_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching order wallets:', error);
    return [];
  }

  return data;
}

/**
 * Get wallets claimed by a sewer
 */
export async function getSewerWallets(sewerId, status = null) {
  let query = supabase
    .from('order_line_items')
    .select(`
      *,
      orders!inner (
        order_number,
        shopify_metadata
      )
    `)
    .eq('claimed_by', sewerId);

  if (status) {
    query = query.eq('status', status);
  }

  query = query.order('claimed_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    console.error('❌ Error fetching sewer wallets:', error);
    return [];
  }

  return data;
}

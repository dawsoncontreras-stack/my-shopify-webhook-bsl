// walletMapping.js
// Configuration and functions for mapping product names to wallet types

/**
 * WALLET TYPE MAPPINGS
 * Based on your product catalog with point values
 */

export const WALLET_MAPPINGS = {
  // 2 POINTS
  'peyton': {
    keywords: ['peyton'],
    points: 2
  },
  'richmond': {
    keywords: ['richmond'],
    points: 2
  },
  'keller-money-clip': {
    keywords: ['keller money clip', 'keller'],
    points: 2
  },
  'georgetown': {
    keywords: ['georgetown'],
    points: 2
  },
  'pflugerville': {
    keywords: ['pflugerville'],
    points: 2
  },
  'minimalist-badge': {
    keywords: ['minimalist badge wallet', 'minimalist badge'],
    points: 2
  },
  'knife-sheath': {
    keywords: ['knife sheath'],
    points: 2
  },
  'keychain': {
    keywords: ['keychain'],
    points: 2
  },

  // 3 POINTS
  'passport-holder': {
    keywords: ['passport holder', 'passport'],
    points: 3
  },
  'victory': {
    keywords: ['victory'],
    points: 3
  },
  'western-vertical': {
    keywords: ['western vertical wallet', 'western vertical'],
    points: 3
  },
  'valet-tray': {
    keywords: ['valet tray'],
    points: 3
  },
  'tyler-vertical': {
    keywords: ['tyler vertical wallet', 'tyler vertical'],
    points: 3
  },
  'mansfield': {
    keywords: ['mansfield'],
    points: 3
  },
  'field-notes-cover': {
    keywords: ['leather field notes cover', 'field notes cover', 'field notes'],
    points: 3
  },
  'badge-vertical': {
    keywords: ['badge vertical wallet', 'badge vertical'],
    points: 3
  },
  'apple-watch-band': {
    keywords: ['apple watch leather band', 'apple watch band', 'watch band'],
    points: 3
  },

  // 4 POINTS
  'glory-snap': {
    keywords: ['glory snap'],
    points: 4
  },
  'federal-badge-small': {
    keywords: ['federal badge wallet small', 'federal badge small'],
    points: 4
  },
  'western-long': {
    keywords: ['western long wallet', 'western long'],
    points: 4
  },
  'houstonian-long': {
    keywords: ['houstonian long wallet', 'houstonian long', 'houstonian'],
    points: 4
  },
  'badge-long': {
    keywords: ['badge long wallet', 'badge long'],
    points: 4
  },

  // 5 POINTS
  'sugar-land-clutch': {
    keywords: ['sugar land clutch', 'sugar land'],
    points: 5
  },
  'western-bifold': {
    keywords: ['western bifold wallet', 'western bifold'],
    points: 5
  },
  'trinity-trifold': {
    keywords: ['trinity trifold wallet', 'trinity trifold', 'trinity'],
    points: 5
  },
  'rio-grande': {
    keywords: ['rio grande'],
    points: 5
  },
  'badge-bifold': {
    keywords: ['badge bifold wallet', 'badge bifold'],
    points: 5
  },

  // 6 POINTS
  'badge-clutch': {
    keywords: ['badge clutch wallet', 'badge clutch'],
    points: 6
  },
  'western-trifold': {
    keywords: ['western trifold wallet', 'western trifold'],
    points: 6
  },
  'big-bend': {
    keywords: ['big bend'],
    points: 6
  },
  'badge-trifold': {
    keywords: ['badge trifold wallet', 'badge trifold'],
    points: 6
  },
};

/**
 * Determine wallet type from product name
 * Returns the wallet_type_id or null if no match
 * 
 * NOTE: This uses a priority system where more specific matches come first
 * For example, "Badge Trifold Wallet" will match 'badge-trifold' before 'badge-bifold'
 */
export function getWalletType(productName) {
  if (!productName) return null;
  
  const name = productName.toLowerCase();
  
  // Sort by keyword length (longest first) to prioritize more specific matches
  const sortedMappings = Object.entries(WALLET_MAPPINGS).sort((a, b) => {
    const maxLengthA = Math.max(...a[1].keywords.map(k => k.length));
    const maxLengthB = Math.max(...b[1].keywords.map(k => k.length));
    return maxLengthB - maxLengthA;
  });
  
  // Check each wallet type's keywords
  for (const [walletType, config] of sortedMappings) {
    // Check if any keyword is present in the product name
    const hasMatch = config.keywords.some(keyword => 
      name.includes(keyword.toLowerCase())
    );
    
    if (hasMatch) {
      return walletType;
    }
  }
  
  return null; // No match found
}

/**
 * Get points for a wallet type
 */
export function getPointsForWalletType(walletType) {
  return WALLET_MAPPINGS[walletType]?.points || 0;
}

/**
 * Get display name for wallet type
 */
export function getWalletDisplayName(walletType) {
  // Convert 'badge-trifold' to 'Badge Trifold'
  return walletType
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Process a line item and assign wallet type and points
 * This should be called from your real-time subscription
 */
export async function processLineItem(supabase, lineItem) {
  // Determine wallet type from product name
  const walletType = getWalletType(lineItem.product_name);
  
  if (!walletType) {
    console.warn('⚠️ Could not determine wallet type for:', lineItem.product_name);
    return null;
  }
  
  const points = getPointsForWalletType(walletType);
  
  // Update the line item
  const { data, error } = await supabase
    .from('order_line_items')
    .update({
      wallet_type: walletType,
      points: points
    })
    .eq('id', lineItem.id)
    .select()
    .single();
  
  if (error) {
    console.error('❌ Error updating line item:', error);
    return null;
  }
  
  console.log(`✅ Assigned ${walletType} (${points} pts) to: ${lineItem.product_name}`);
  return data;
}

/**
 * Process all line items for an order
 */
export async function processOrderLineItems(supabase, orderId) {
  // Get all line items for this order
  const { data: lineItems, error: fetchError } = await supabase
    .from('order_line_items')
    .select('*')
    .eq('order_id', orderId);
  
  if (fetchError) {
    console.error('❌ Error fetching line items:', fetchError);
    return;
  }
  
  // Process each line item
  const results = await Promise.all(
    lineItems.map(item => processLineItem(supabase, item))
  );
  
  // Calculate total points for the order
  const totalPoints = results
    .filter(Boolean)
    .reduce((sum, item) => sum + item.points, 0);
  
  // Update parent order with total points
  await supabase
    .from('orders')
    .update({ points: totalPoints })
    .eq('id', orderId);
  
  console.log(`✅ Processed ${results.length} line items, total points: ${totalPoints}`);
  
  return results;
}

/**
 * HELPER: Get all unmapped line items
 * Useful for debugging or initial data migration
 */
export async function getUnmappedLineItems(supabase) {
  const { data, error } = await supabase
    .from('order_line_items')
    .select('*')
    .is('wallet_type', null);
  
  if (error) {
    console.error('Error fetching unmapped items:', error);
    return [];
  }
  
  return data;
}

/**
 * HELPER: Batch process all unmapped line items
 * Run this after setting up your mappings
 */
export async function processAllUnmappedLineItems(supabase) {
  const unmappedItems = await getUnmappedLineItems(supabase);
  
  console.log(`Found ${unmappedItems.length} unmapped line items`);
  
  for (const item of unmappedItems) {
    await processLineItem(supabase, item);
  }
  
  console.log('✅ Finished processing all unmapped items');
}

/**
 * HELPER: Test your mappings
 * Run this to verify products are being matched correctly
 */
export function testMappings() {
  const testProducts = [
    "Peyton",
    "The Richmond",
    "Keller Money Clip",
    "The Georgetown",
    "Pflugerville",
    "Minimalist Badge Wallet",
    "Knife Sheath",
    "Keychain",
    "Passport Holder",
    "Victory",
    "Western Vertical Wallet",
    "Valet Tray",
    "Tyler Vertical Wallet",
    "Mansfield",
    "Leather Field Notes Cover",
    "Badge Vertical Wallet",
    "Apple Watch Leather Band",
    "Glory Snap",
    "Federal Badge Wallet Small",
    "Western Long Wallet",
    "The Houstonian Long Wallet",
    "Badge Long Wallet",
    "Sugar Land Clutch",
    "Western Bifold Wallet",
    "Trinity Trifold Wallet",
    "Rio Grande",
    "Badge Bifold Wallet",
    "Badge Clutch Wallet",
    "Western Trifold Wallet",
    "Big Bend",
    "Badge Trifold Wallet"
  ];

  console.log('Testing wallet mappings...\n');
  
  testProducts.forEach(product => {
    const type = getWalletType(product);
    const points = type ? getPointsForWalletType(type) : 0;
    const status = type ? '✅' : '❌';
    console.log(`${status} "${product}" → ${type || 'NO MATCH'} (${points} pts)`);
  });
}

// Uncomment to test:
// testMappings();

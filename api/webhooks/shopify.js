// src/lib/walletMapping.js
// UPDATED VERSION - Expanded wallet types with better matching and accessory handling

/**
 * EXPANDED WALLET TYPE MAPPINGS
 * Now using product name as wallet_type for maximum flexibility
 */

export const WALLET_MAPPINGS = {
  // 2 POINTS
  'Peyton': {
    keywords: ['peyton'],
    points: 2
  },
  'The Richmond': {
    keywords: ['richmond'],
    points: 2
  },
  'Keller Money Clip': {
    keywords: ['keller money clip', 'keller'],
    points: 2
  },
  'The Georgetown': {
    keywords: ['georgetown'],
    points: 2
  },
  'Pflugerville': {
    keywords: ['pflugerville'],
    points: 2
  },
  'Minimalist Badge Wallet': {
    keywords: ['minimalist badge wallet', 'minimalist badge'],
    points: 2
  },
  'Knife Sheath': {
    keywords: ['knife sheath'],
    points: 2
  },
  'Keychain': {
    keywords: ['keychain'],
    points: 2
  },

  // 3 POINTS
  'Passport Holder': {
    keywords: ['passport holder', 'passport'],
    points: 3
  },
  'Victory': {
    keywords: ['victory'],
    points: 3
  },
  'Western Vertical Wallet': {
    keywords: ['western vertical wallet', 'western vertical'],
    points: 3
  },
  'Valet Tray': {
    keywords: ['valet tray'],
    points: 3
  },
  'Tyler Vertical Wallet': {
    keywords: ['tyler vertical wallet', 'tyler vertical'],
    points: 3
  },
  'Mansfield': {
    keywords: ['mansfield'],
    points: 3
  },
  'Leather Field Notes Cover': {
    keywords: ['leather field notes cover', 'field notes cover', 'field notes'],
    points: 3
  },
  'Badge Vertical Wallet': {
    keywords: ['badge vertical wallet', 'badge vertical'],
    points: 3
  },
  'Apple Watch Leather Band': {
    keywords: ['apple watch leather band', 'apple watch band', 'watch band'],
    points: 3
  },

  // 4 POINTS
  'Glory Snap': {
    keywords: ['glory snap'],
    points: 4
  },
  'Federal Badge Wallet Small': {
    keywords: ['federal badge wallet small', 'federal badge small'],
    points: 4
  },
  'Western Long Wallet': {
    keywords: ['western long wallet', 'western long'],
    points: 4
  },
  'The Houstonian Long Wallet': {
    keywords: ['houstonian long wallet', 'houstonian long', 'houstonian'],
    points: 4
  },
  'Badge Long Wallet': {
    keywords: ['badge long wallet', 'badge long'],
    points: 4
  },

  // 5 POINTS
  'Sugar Land Clutch': {
    keywords: ['sugar land clutch', 'sugar land'],
    points: 5
  },
  'Western Bifold Wallet': {
    keywords: ['western bifold wallet', 'western bifold'],
    points: 5
  },
  'Trinity Trifold Wallet': {
    keywords: ['trinity trifold wallet', 'trinity trifold', 'trinity'],
    points: 5
  },
  'Rio Grande': {
    keywords: ['rio grande'],
    points: 5
  },
  'Badge Bifold Wallet': {
    keywords: ['badge bifold wallet', 'badge bifold'],
    points: 5
  },

  // 6 POINTS
  'Badge Clutch Wallet': {
    keywords: ['badge clutch wallet', 'badge clutch'],
    points: 6
  },
  'Western Trifold Wallet': {
    keywords: ['western trifold wallet', 'western trifold'],
    points: 6
  },
  'Big Bend': {
    keywords: ['big bend'],
    points: 6
  },
  'Badge Trifold Wallet': {
    keywords: ['badge trifold wallet', 'badge trifold'],
    points: 6
  },
};

/**
 * Determine wallet type from product name
 * Returns the wallet type name (e.g., "Badge Trifold Wallet") or null if no match
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
    const hasMatch = config.keywords.some(keyword => 
      name.includes(keyword.toLowerCase())
    );
    
    if (hasMatch) {
      return walletType; // Return the full name like "Badge Trifold Wallet"
    }
  }
  
  return null;
}

/**
 * Get points for a wallet type
 */
export function getPointsForWalletType(walletType) {
  return WALLET_MAPPINGS[walletType]?.points || 0;
}

/**
 * Check if a product is an accessory (not a wallet)
 */
export function isAccessory(productName) {
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
 * Process a line item and assign wallet type and points
 * Now handles accessories separately
 */
export async function processLineItem(supabase, lineItem) {
  // Skip if it's an accessory
  if (lineItem.item_type === 'accessory') {
    console.log(`⚙️ Skipping accessory: ${lineItem.product_name}`);
    return lineItem;
  }

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
 * Separates wallets from accessories and updates order totals
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
  
  // Separate wallets from accessories
  const walletItems = lineItems.filter(item => item.item_type === 'wallet');
  const accessoryItems = lineItems.filter(item => item.item_type === 'accessory');
  
  console.log(`Processing ${walletItems.length} wallets and ${accessoryItems.length} accessories`);
  
  // Process only wallet items
  const results = await Promise.all(
    walletItems.map(item => processLineItem(supabase, item))
  );
  
  // Calculate total points for the order (wallets only)
  const totalPoints = results
    .filter(Boolean)
    .reduce((sum, item) => sum + item.points, 0);
  
  // Collate all wallet types
  const walletTypes = results
    .filter(Boolean)
    .map(item => item.wallet_type)
    .filter(Boolean)
    .join(', ');
  
  // Update parent order with totals
  await supabase
    .from('orders')
    .update({ 
      points: totalPoints,
      wallet_type: walletTypes,
      total_wallets: walletItems.length,
      total_accessories: accessoryItems.length
    })
    .eq('id', orderId);
  
  console.log(`✅ Processed order: ${walletItems.length} wallets (${totalPoints} pts), ${accessoryItems.length} accessories`);
  console.log(`   Wallet types: ${walletTypes}`);
  
  return results;
}

/**
 * Get wallet customization summary
 * Useful for displaying wallet details in UI
 */
export function getWalletCustomizationSummary(walletAttributes) {
  if (!walletAttributes) return [];
  
  const customizations = [];
  
  if (walletAttributes.color) {
    customizations.push(`Color: ${walletAttributes.color}`);
  }
  
  if (walletAttributes.has_monogram) {
    const text = walletAttributes.monogram_text ? ` (${walletAttributes.monogram_text})` : '';
    const font = walletAttributes.monogram_font ? ` - ${walletAttributes.monogram_font}` : '';
    customizations.push(`Monogram${text}${font}`);
  }
  
  if (walletAttributes.has_special_engraving) {
    const text = walletAttributes.special_engraving_text ? ` (${walletAttributes.special_engraving_text})` : '';
    const font = walletAttributes.engraving_font ? ` - ${walletAttributes.engraving_font}` : '';
    const location = walletAttributes.engraving_location ? ` at ${walletAttributes.engraving_location}` : '';
    customizations.push(`Special Engraving${text}${font}${location}`);
  }
  
  if (walletAttributes.has_custom_id) {
    const text = walletAttributes.custom_id_text ? ` (${walletAttributes.custom_id_text})` : '';
    customizations.push(`Custom ID${text}`);
  }
  
  if (walletAttributes.has_badge_cutout) {
    const type = walletAttributes.badge_type ? ` (${walletAttributes.badge_type})` : '';
    customizations.push(`Badge Cutout${type}`);
  } else if (walletAttributes.badge_type) {
    customizations.push(`Badge Type: ${walletAttributes.badge_type}`);
  }
  
  if (walletAttributes.has_custom_logo) {
    const details = walletAttributes.custom_logo_details ? ` (${walletAttributes.custom_logo_details})` : '';
    customizations.push(`Custom Logo${details}`);
  }
  
  if (walletAttributes.thread_color) {
    customizations.push(`Thread: ${walletAttributes.thread_color}`);
  }
  
  if (walletAttributes.customer_note) {
    customizations.push(`Note: ${walletAttributes.customer_note}`);
  }
  
  if (walletAttributes.other_customizations?.length > 0) {
    walletAttributes.other_customizations.forEach(custom => {
      customizations.push(`${custom.name}: ${custom.value}`);
    });
  }
  
  return customizations;
}

/**
 * HELPER: Get all unmapped line items (wallets only)
 */
export async function getUnmappedLineItems(supabase) {
  const { data, error } = await supabase
    .from('order_line_items')
    .select('*')
    .eq('item_type', 'wallet')
    .is('wallet_type', null);
  
  if (error) {
    console.error('Error fetching unmapped items:', error);
    return [];
  }
  
  return data;
}

/**
 * HELPER: Batch process all unmapped wallet line items
 */
export async function processAllUnmappedLineItems(supabase) {
  const unmappedItems = await getUnmappedLineItems(supabase);
  
  console.log(`Found ${unmappedItems.length} unmapped wallet items`);
  
  for (const item of unmappedItems) {
    await processLineItem(supabase, item);
  }
  
  console.log('✅ Finished processing all unmapped items');
}

/**
 * HELPER: Test your mappings
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
    "Badge Trifold Wallet",
    // Accessories
    "RFID Blocking Card",
    "Monogram Add-On",
    "Gift Wrap Service"
  ];

  console.log('Testing wallet mappings...\n');
  
  testProducts.forEach(product => {
    const type = getWalletType(product);
    const isAcc = isAccessory(product);
    const points = type ? getPointsForWalletType(type) : 0;
    
    if (isAcc) {
      console.log(`⚙️ "${product}" → ACCESSORY (no points)`);
    } else if (type) {
      console.log(`✅ "${product}" → ${type} (${points} pts)`);
    } else {
      console.log(`❌ "${product}" → NO MATCH`);
    }
  });
}

// Uncomment to test:
// testMappings();
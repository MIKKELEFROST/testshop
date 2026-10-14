<?php
// Tax: Danish 25% standard rate, applies to shipping too.
WC_Tax::_insert_tax_rate(array('tax_rate_country'=>'DK','tax_rate'=>'25.0000','tax_rate_name'=>'Moms','tax_rate_priority'=>1,'tax_rate_compound'=>0,'tax_rate_shipping'=>1,'tax_rate_order'=>0,'tax_rate_class'=>''));
// Shipping zone Denmark: flat rate 39.20 ex VAT (49 incl.) + free shipping from 500 + local pickup
$zone = new WC_Shipping_Zone();
$zone->set_zone_name('Danmark'); $zone->set_zone_order(1); $zone->add_location('DK','country'); $zone->save();
$iid = $zone->add_shipping_method('flat_rate');
update_option('woocommerce_flat_rate_'.$iid.'_settings', array('title'=>'GLS Pakkeshop','tax_status'=>'taxable','cost'=>'39.20'));
$iid2 = $zone->add_shipping_method('free_shipping');
update_option('woocommerce_free_shipping_'.$iid2.'_settings', array('title'=>'Gratis fragt','requires'=>'min_amount','min_amount'=>'500','ignore_discounts'=>'no'));
$iid3 = $zone->add_shipping_method('local_pickup');
update_option('woocommerce_local_pickup_'.$iid3.'_settings', array('title'=>'Afhentning i butik','tax_status'=>'taxable','cost'=>'0'));
// Categories
$cat = function($name){ $t = wp_insert_term($name,'product_cat'); return is_wp_error($t) ? $t->get_error_data() : $t['term_id']; };
$c1 = $cat('Tøj'); $c2 = $cat('Accessories'); $c3 = $cat('Hjem');
$mk = function($name,$price,$sale,$stock,$cats,$sku,$desc){
  $p = new WC_Product_Simple(); $p->set_name($name); $p->set_regular_price($price); if($sale) $p->set_sale_price($sale);
  $p->set_manage_stock(true); $p->set_stock_quantity($stock); $p->set_category_ids($cats); $p->set_sku($sku);
  $p->set_description($desc); $p->set_short_description(wp_trim_words($desc,14)); $p->set_status('publish'); return $p->save(); };
$mk('Basis T-shirt i økologisk bomuld','249',null,25,array($c1),'TS-001','En blød og holdbar T-shirt i 100% økologisk bomuld. Klassisk pasform, der passer til alt.');
$mk('Uldhue','199','149',10,array($c2),'HUE-001','Varm hue i merinould. Kløer ikke og holder formen vask efter vask.');
$mk('Lærredsmulepose','129',null,1,array($c2),'TOTE-001','Rummelig mulepose i kraftigt lærred med indvendig lomme. Kun én på lager.');
$mk('Duftlys – Figen','179',null,0,array($c3),'LYS-001','Håndhældt duftlys i sojavoks med noter af figen og cedertræ. Brændetid ca. 40 timer.');
// Variable product with sizes
$attr = new WC_Product_Attribute(); $attr->set_name('Størrelse'); $attr->set_options(array('S','M','L')); $attr->set_visible(true); $attr->set_variation(true);
$vp = new WC_Product_Variable(); $vp->set_name('Hættetrøje'); $vp->set_attributes(array($attr)); $vp->set_category_ids(array($c1)); $vp->set_sku('HOOD');
$vp->set_description('Tung hættetrøje i børstet bomuld med kængurulomme. Unisex pasform.'); $vp->set_short_description('Tung hættetrøje i børstet bomuld.'); $vp->set_status('publish'); $vpid = $vp->save();
foreach (array('S'=>5,'M'=>2,'L'=>0) as $size=>$qty) { $v = new WC_Product_Variation(); $v->set_parent_id($vpid); $v->set_attributes(array(sanitize_title("Størrelse")=>$size)); $v->set_regular_price('449'); $v->set_manage_stock(true); $v->set_stock_quantity($qty); $v->set_sku('HOOD-'.$size); $v->set_status('publish'); $v->save(); }
WC_Product_Variable::sync($vpid);
// REST API key for local tests (read/write) for admin user 1
global $wpdb;
$ck = 'ck_localtest0000000000000000000000000000'; $cs = 'cs_localtest0000000000000000000000000000';
$wpdb->insert($wpdb->prefix.'woocommerce_api_keys', array('user_id'=>1,'description'=>'Headless local','permissions'=>'read_write','consumer_key'=>wc_api_hash($ck),'consumer_secret'=>$cs,'truncated_key'=>substr($ck,-7)));
echo "seeded\n";

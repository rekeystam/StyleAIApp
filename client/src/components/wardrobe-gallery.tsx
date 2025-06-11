import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Grid3x3, List, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ClothingItem } from "@shared/schema";

export function WardrobeGallery() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery<ClothingItem[]>({
    queryKey: ['/api/clothing-items'],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/clothing-items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clothing-items'] });
      toast({
        title: "Item deleted",
        description: "Clothing item has been removed from your wardrobe.",
      });
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Failed to delete clothing item.",
        variant: "destructive",
      });
    },
  });

  // Get unique categories, filtering out empty/null/undefined values
  const validCategories = items
    .map(item => item.category)
    .filter(cat => cat && typeof cat === 'string' && cat.trim() !== '');

  const categories = ['all', ...Array.from(new Set(validCategories))];
  const filteredItems = filterCategory === 'all' ? items : items.filter(item => item.category === filterCategory);

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      tops: 'bg-blue-500',
      bottoms: 'bg-indigo-600',
      dresses: 'bg-pink-400',
      outerwear: 'bg-gray-800',
      accessories: 'bg-purple-500',
      shoes: 'bg-gray-300',
    };
    return colors[category] || 'bg-gray-400';
  };

  const getStyleBadge = (style: string) => {
    const badges: Record<string, string> = {
      casual: 'Casual',
      formal: 'Formal',
      business: 'Business',
      sporty: 'Athletic',
      bohemian: 'Boho',
      vintage: 'Vintage',
      modern: 'Modern',
    };
    return badges[style] || style;
  };

    // Helper function to convert color names to hex values (expand as needed)
    const getColorValue = (color: string) => {
      const colorMap: Record<string, string> = {
        red: '#FF0000',
        blue: '#0000FF',
        green: '#008000',
        black: '#000000',
        white: '#FFFFFF',
        gray: '#808080',
        purple: '#800080',
        yellow: '#FFFF00',
        orange: '#FFA500',
        brown: '#A52A2A',
        beige: '#F5F5DC',
        navy: '#000080',
        burgundy: '#800020',
      };
      return colorMap[color.toLowerCase()] || '#ccc'; // Default to grey if color is unknown
    };


  if (isLoading) {
    return (
      <section className="py-16 bg-gray-50" id="wardrobe">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
            {Array(12).fill(0).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="w-full h-48" />
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2 mb-2" />
                  <Skeleton className="h-3 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 bg-gray-50" id="wardrobe">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-12">
          <div>
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 font-serif mb-2">
              Your Wardrobe
            </h2>
            <p className="text-lg text-gray-600">
              {items.length} items analyzed and categorized
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(category => (
                  <SelectItem key={category} value={category}>
                    {category === 'all' ? 'All Categories' : category.charAt(0).toUpperCase() + category.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('grid')}
            >
              <Grid3x3 className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('list')}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-gray-500">
              <h3 className="text-lg font-semibold mb-2">No items found</h3>
              <p>
                {filterCategory === 'all' 
                  ? "Upload some clothing items to get started!"
                  : `No ${filterCategory} items in your wardrobe yet.`
                }
              </p>
            </div>
          </Card>
        ) : (
          <div className={viewMode === 'grid' 
            ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6"
            : "space-y-4"
          }>
            {filteredItems.map((item) => {
              const analysis = item.aiAnalysis ? JSON.parse(item.aiAnalysis) : {};

              return (
                  <Card key={item.id} className={`group relative overflow-hidden transition-all hover:shadow-lg ${
                    viewMode === 'list' ? 'flex items-center p-4' : ''
                  }`}>
                    {viewMode === 'list' && (
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteMutation.mutate(item.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    <div className={viewMode === 'list' ? 'flex-shrink-0 mr-4' : ''}>
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className={`object-cover transition-transform group-hover:scale-105 ${
                          viewMode === 'list' ? 'w-20 h-20 rounded-lg' : 'w-full h-48'
                        }`}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = `data:image/svg+xml,${encodeURIComponent(`
                            <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
                              <rect width="200" height="200" fill="#f3f4f6"/>
                              <text x="100" y="100" text-anchor="middle" fill="#9ca3af" font-size="14" font-family="Arial">
                                Image not found
                              </text>
                            </svg>
                          `)}`;
                        }}
                      />
                    </div>

                    <CardContent className={`${viewMode === 'list' ? 'flex-1 p-0' : 'p-4'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 mb-1 group-hover:text-indigo-600 transition-colors">
                            {item.name}
                          </h3>

                          <div className="flex flex-wrap gap-2 mb-2">
                            {/* Show subcategory if available, otherwise category */}
                            <Badge variant="secondary" className={`${getCategoryColor(item.category)} text-white text-xs`}>
                              {analysis.subcategory || item.category}
                            </Badge>
                            {item.style && (
                              <Badge variant="outline" className="text-xs capitalize">
                                {item.style.replace('_', ' ')}
                              </Badge>
                            )}
                            {analysis.formality && analysis.formality !== item.style && (
                              <Badge variant="outline" className="text-xs text-purple-600 border-purple-200">
                                {analysis.formality.replace('_', ' ')}
                              </Badge>
                            )}
                          </div>

                          {/* Enhanced color display */}
                          {item.colors && item.colors.length > 0 && item.colors[0] !== 'unknown' && (
                            <div className="mb-2">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs text-gray-500">Colors:</span>
                                <div className="flex flex-wrap gap-1">
                                  {item.colors.slice(0, 4).map((color, index) => {
                                    const colorValue = getColorValue(color);
                                    return (
                                      <div key={index} className="flex items-center gap-1">
                                        <div
                                          className="w-3 h-3 rounded-full border border-gray-300 shadow-sm"
                                          style={{ backgroundColor: colorValue }}
                                          title={color}
                                        />
                                        {index === 0 && (
                                          <span className="text-xs text-gray-600 capitalize">
                                            {color.replace('_', ' ')}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {item.colors.length > 4 && (
                                    <span className="text-xs text-gray-500">
                                      +{item.colors.length - 4}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Show additional AI analysis details */}
                          {analysis.pattern && analysis.pattern !== 'unknown' && (
                            <div className="text-xs text-gray-500 mb-1">
                              Pattern: <span className="capitalize">{analysis.pattern.replace('_', ' ')}</span>
                            </div>
                          )}

                          {analysis.fabric_type && analysis.fabric_type !== 'unknown' && (
                            <div className="text-xs text-gray-500 mb-1">
                              Material: <span className="capitalize">{analysis.fabric_type.replace('_', ' ')}</span>
                            </div>
                          )}

                          {analysis.description && (
                            <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                              {analysis.description}
                            </p>
                          )}

                          {item.isVerified && (
                            <div className="flex items-center gap-1 text-green-600">
                              <Star className="h-3 w-3 fill-current" />
                              <span className="text-xs">AI Verified</span>
                            </div>
                          )}
                        </div>

                        {viewMode === 'grid' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteMutation.mutate(item.id)}
                            disabled={deleteMutation.isPending}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
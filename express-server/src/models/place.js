'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Place extends Model {
    static associate(models) {}
  }

  Place.init({
    gu_id:       { type: DataTypes.INTEGER, allowNull: true },
    category:    { type: DataTypes.ENUM('ACCOMMODATION', 'RESTAURANT', 'CAFE', 'ATTRACTION', 'PLAYGROUND', 'STORE', 'SHOP'), allowNull: false },
    place_id:    { type: DataTypes.STRING(100), allowNull: true, unique: true },
    source:      { type: DataTypes.ENUM('TRIPADVISOR', 'CSV'), allowNull: false, defaultValue: 'TRIPADVISOR' },
    coordinates: { type: DataTypes.GEOMETRY('POINT', 4326), allowNull: true },
    rating:      { type: DataTypes.DECIMAL(3, 2) },
    num_reviews: { type: DataTypes.INTEGER },
    cached_at:   { type: DataTypes.DATE },
    raw_data:    { type: DataTypes.JSON },
  }, {
    sequelize,
    modelName: 'Place',
  });

  return Place;
};